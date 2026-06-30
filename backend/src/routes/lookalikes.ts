import { Hono } from 'hono'
import { db } from '../db/index.js'
import {
  accounts,
  products,
  ownership,
  whitespace_sizing,
  lookalike_suggestions,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// GET / — public — list look-alike suggestions
// Filters: account_id, min_adoption (0..1), min_arr (cents).
// ---------------------------------------------------------------------------
router.get('/', async (c) => {
  const userId = c.req.header('X-User-Id') ?? c.req.header('x-user-id') ?? ''
  if (!userId) return c.json([])

  const accountId = c.req.query('account_id')
  const minAdoption = c.req.query('min_adoption')
  const minArr = c.req.query('min_arr')

  const conds = [eq(lookalike_suggestions.user_id, userId)]
  if (accountId) conds.push(eq(lookalike_suggestions.account_id, accountId))

  let rows = await db
    .select()
    .from(lookalike_suggestions)
    .where(and(...conds))
    .orderBy(desc(lookalike_suggestions.score))

  if (minAdoption) {
    const m = parseFloat(minAdoption)
    if (!Number.isNaN(m)) rows = rows.filter((r) => r.adoption_rate >= m)
  }
  if (minArr) {
    const m = parseInt(minArr, 10)
    if (!Number.isNaN(m)) rows = rows.filter((r) => r.open_arr_cents >= m)
  }

  return c.json(rows)
})

// ---------------------------------------------------------------------------
// POST /compute — auth — recompute adoption-based look-alike suggestions.
//
// Deterministic algorithm (no randomness, no ML):
//   For each account A and each product P that A does NOT own:
//     peers       = other accounts in A's segment
//     adopters    = peers that DO own P
//     adoptionRate = adopters / peers
//   A suggestion is produced when adoptionRate > 0 (at least one same-segment
//   peer owns the product). The score blends peer adoption with normalized
//   open ARR so high-adoption, high-value cells rank first. open_arr_cents is
//   pulled from the latest whitespace_sizing for the cell when available, else
//   the product's default expansion ARR.
// ---------------------------------------------------------------------------
router.post('/compute', authMiddleware, async (c) => {
  const userId = getUserId(c)

  const [acctRows, prodRows, ownRows, sizeRows] = await Promise.all([
    db.select().from(accounts).where(eq(accounts.user_id, userId)),
    db
      .select()
      .from(products)
      .where(and(eq(products.user_id, userId), eq(products.is_active, true))),
    db.select().from(ownership).where(eq(ownership.user_id, userId)),
    db.select().from(whitespace_sizing).where(eq(whitespace_sizing.user_id, userId)),
  ])

  const prodById = new Map(prodRows.map((p) => [p.id, p]))

  // ownership index: per product → set of owning account ids; per account → set of owned products.
  const ownersByProduct = new Map<string, Set<string>>()
  const ownedByAccount = new Map<string, Set<string>>()
  for (const o of ownRows) {
    let op = ownersByProduct.get(o.product_id)
    if (!op) {
      op = new Set()
      ownersByProduct.set(o.product_id, op)
    }
    op.add(o.account_id)

    let oa = ownedByAccount.get(o.account_id)
    if (!oa) {
      oa = new Set()
      ownedByAccount.set(o.account_id, oa)
    }
    oa.add(o.product_id)
  }

  // accounts grouped by segment (null segment grouped under its own bucket).
  const bySegment = new Map<string, typeof acctRows>()
  for (const a of acctRows) {
    const seg = a.segment ?? '__none__'
    const list = bySegment.get(seg) ?? []
    list.push(a)
    bySegment.set(seg, list)
  }

  // latest sizing per (account, product) for open ARR lookup.
  const sizeByKey = new Map<string, (typeof sizeRows)[number]>()
  for (const s of sizeRows) {
    const k = `${s.account_id}:${s.product_id}`
    const prev = sizeByKey.get(k)
    if (!prev || new Date(s.computed_at).getTime() > new Date(prev.computed_at).getTime()) {
      sizeByKey.set(k, s)
    }
  }

  // Max default expansion across catalog, used to normalize the ARR component.
  let maxArr = 1
  for (const p of prodRows) maxArr = Math.max(maxArr, p.default_expansion_arr_cents)
  for (const s of sizeRows) maxArr = Math.max(maxArr, s.open_arr_cents)

  type Suggestion = {
    account_id: string
    product_id: string
    segment: string | null
    adoption_rate: number
    peer_count: number
    open_arr_cents: number
    score: number
    explanation: string
  }

  const suggestions: Suggestion[] = []

  for (const a of acctRows) {
    const segKey = a.segment ?? '__none__'
    const segPeers = (bySegment.get(segKey) ?? []).filter((p) => p.id !== a.id)
    if (segPeers.length === 0) continue
    const ownedByA = ownedByAccount.get(a.id) ?? new Set<string>()

    for (const p of prodRows) {
      if (ownedByA.has(p.id)) continue // already owns it
      const productOwners = ownersByProduct.get(p.id) ?? new Set<string>()
      let adopters = 0
      for (const peer of segPeers) if (productOwners.has(peer.id)) adopters += 1
      if (adopters === 0) continue

      const peerCount = segPeers.length
      const adoptionRate = adopters / peerCount
      const sized = sizeByKey.get(`${a.id}:${p.id}`)
      const openArr = sized?.open_arr_cents ?? p.default_expansion_arr_cents
      const arrComponent = Math.min(1, openArr / maxArr)
      // Deterministic blend: 70% adoption, 30% normalized ARR.
      const score = adoptionRate * 0.7 + arrComponent * 0.3

      suggestions.push({
        account_id: a.id,
        product_id: p.id,
        segment: a.segment ?? null,
        adoption_rate: adoptionRate,
        peer_count: peerCount,
        open_arr_cents: openArr,
        score,
        explanation: `${adopters} of ${peerCount} ${a.segment ?? 'peer'} accounts own ${p.name} (${Math.round(
          adoptionRate * 100,
        )}% adoption); open ARR ~$${Math.round(openArr / 100).toLocaleString()}.`,
      })
    }
  }

  // Rebuild the suggestion set for this user.
  await db.delete(lookalike_suggestions).where(eq(lookalike_suggestions.user_id, userId))

  const computedAt = new Date()
  for (const s of suggestions) {
    await db
      .insert(lookalike_suggestions)
      .values({
        user_id: userId,
        account_id: s.account_id,
        product_id: s.product_id,
        segment: s.segment,
        adoption_rate: s.adoption_rate,
        peer_count: s.peer_count,
        open_arr_cents: s.open_arr_cents,
        score: s.score,
        explanation: s.explanation,
        computed_at: computedAt,
      })
      .onConflictDoUpdate({
        target: [lookalike_suggestions.account_id, lookalike_suggestions.product_id],
        set: {
          segment: s.segment,
          adoption_rate: s.adoption_rate,
          peer_count: s.peer_count,
          open_arr_cents: s.open_arr_cents,
          score: s.score,
          explanation: s.explanation,
          computed_at: computedAt,
        },
      })
  }

  suggestions.sort((a, b) => b.score - a.score)
  return c.json({ suggestions })
})

export default router
