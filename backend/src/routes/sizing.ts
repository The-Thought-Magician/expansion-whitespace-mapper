import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  accounts,
  products,
  price_book,
  ownership,
  seat_usage,
  eligibility_cells,
  whitespace_sizing,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const computeSchema = z.object({
  method: z.enum(['list_price', 'per_seat', 'default_expansion', 'current_arr_uplift']).optional().default('list_price'),
})

// ---------------------------------------------------------------------------
// Sizing engine — deterministic open-ARR estimation per eligible cell.
//
// For one (account, product) the open ARR depends on the chosen method:
//   - list_price          → segment-matched price_book.list_price_cents
//   - per_seat            → per_seat_cents * licensed seats (from seat_usage)
//   - default_expansion   → product.default_expansion_arr_cents
//   - current_arr_uplift  → 20% of the account's current ARR (deterministic)
// A low/high band is produced at +/-25% to express confidence.
// ---------------------------------------------------------------------------
function pickPriceEntry(
  entries: Array<{ segment: string | null; list_price_cents: number; per_seat_cents: number }>,
  segment: string | null,
) {
  // Prefer an exact segment match, then a segment-less (default) entry.
  return (
    entries.find((e) => e.segment && segment && e.segment === segment) ??
    entries.find((e) => !e.segment) ??
    entries[0]
  )
}

function sizeCell(
  method: string,
  account: { current_arr_cents: number; segment: string | null },
  product: { default_expansion_arr_cents: number },
  priceEntries: Array<{ segment: string | null; list_price_cents: number; per_seat_cents: number }>,
  seats: { licensed_seats: number; active_seats: number } | undefined,
): { open: number; low: number; high: number; confidence: string } {
  let open = 0
  let confidence = 'expected'
  const entry = pickPriceEntry(priceEntries, account.segment)

  switch (method) {
    case 'per_seat': {
      const perSeat = entry?.per_seat_cents ?? 0
      const seatCount = seats?.licensed_seats || seats?.active_seats || 0
      open = perSeat * seatCount
      confidence = seatCount > 0 && perSeat > 0 ? 'expected' : 'low'
      if (open === 0) open = product.default_expansion_arr_cents
      break
    }
    case 'default_expansion': {
      open = product.default_expansion_arr_cents
      confidence = open > 0 ? 'expected' : 'low'
      break
    }
    case 'current_arr_uplift': {
      open = Math.round(account.current_arr_cents * 0.2)
      confidence = account.current_arr_cents > 0 ? 'expected' : 'low'
      if (open === 0) open = product.default_expansion_arr_cents
      break
    }
    case 'list_price':
    default: {
      open = entry?.list_price_cents ?? 0
      confidence = open > 0 ? 'expected' : 'low'
      if (open === 0) open = product.default_expansion_arr_cents
      break
    }
  }

  const low = Math.round(open * 0.75)
  const high = Math.round(open * 1.25)
  return { open, low, high, confidence }
}

// ---------------------------------------------------------------------------
// GET / — public — list sized whitespace cells (filter: account_id)
// Returns only the latest sizing row per (account, product).
// ---------------------------------------------------------------------------
router.get('/', async (c) => {
  const userId = c.req.header('X-User-Id') ?? c.req.header('x-user-id') ?? ''
  if (!userId) return c.json([])
  const accountId = c.req.query('account_id')

  const conds = [eq(whitespace_sizing.user_id, userId)]
  if (accountId) conds.push(eq(whitespace_sizing.account_id, accountId))

  const rows = await db
    .select()
    .from(whitespace_sizing)
    .where(and(...conds))
    .orderBy(desc(whitespace_sizing.computed_at))

  // Dedupe to latest per (account, product).
  const seen = new Set<string>()
  const latest = rows.filter((r) => {
    const k = `${r.account_id}:${r.product_id}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })

  return c.json(latest)
})

// ---------------------------------------------------------------------------
// GET /rollups — public — open ARR rolled up by account / csm / segment / total
// ---------------------------------------------------------------------------
router.get('/rollups', async (c) => {
  const userId = c.req.header('X-User-Id') ?? c.req.header('x-user-id') ?? ''
  if (!userId) return c.json({ total: 0, byAccount: [], byCsm: [], bySegment: [] })

  const [sizeRows, acctRows] = await Promise.all([
    db.select().from(whitespace_sizing).where(eq(whitespace_sizing.user_id, userId)),
    db.select().from(accounts).where(eq(accounts.user_id, userId)),
  ])

  // Latest sizing per (account, product).
  const latestMap = new Map<string, (typeof sizeRows)[number]>()
  for (const s of sizeRows) {
    const k = `${s.account_id}:${s.product_id}`
    const prev = latestMap.get(k)
    if (!prev || new Date(s.computed_at).getTime() > new Date(prev.computed_at).getTime()) {
      latestMap.set(k, s)
    }
  }

  const acctById = new Map(acctRows.map((a) => [a.id, a]))

  let total = 0
  const byAccount = new Map<string, { account_id: string; name: string; open_arr_cents: number; cells: number }>()
  const byCsm = new Map<string, { csm_owner: string; open_arr_cents: number; cells: number }>()
  const bySegment = new Map<string, { segment: string; open_arr_cents: number; cells: number }>()

  for (const s of latestMap.values()) {
    total += s.open_arr_cents
    const acct = acctById.get(s.account_id)

    const aKey = s.account_id
    const aEntry = byAccount.get(aKey) ?? {
      account_id: s.account_id,
      name: acct?.name ?? 'Unknown',
      open_arr_cents: 0,
      cells: 0,
    }
    aEntry.open_arr_cents += s.open_arr_cents
    aEntry.cells += 1
    byAccount.set(aKey, aEntry)

    const csm = acct?.csm_owner ?? 'Unassigned'
    const cEntry = byCsm.get(csm) ?? { csm_owner: csm, open_arr_cents: 0, cells: 0 }
    cEntry.open_arr_cents += s.open_arr_cents
    cEntry.cells += 1
    byCsm.set(csm, cEntry)

    const seg = acct?.segment ?? 'Unsegmented'
    const sEntry = bySegment.get(seg) ?? { segment: seg, open_arr_cents: 0, cells: 0 }
    sEntry.open_arr_cents += s.open_arr_cents
    sEntry.cells += 1
    bySegment.set(seg, sEntry)
  }

  const sortDesc = <T extends { open_arr_cents: number }>(arr: T[]) =>
    arr.sort((a, b) => b.open_arr_cents - a.open_arr_cents)

  return c.json({
    total,
    byAccount: sortDesc(Array.from(byAccount.values())),
    byCsm: sortDesc(Array.from(byCsm.values())),
    bySegment: sortDesc(Array.from(bySegment.values())),
  })
})

// ---------------------------------------------------------------------------
// POST /compute — auth — (re)size all eligible cells (body: method)
//
// Replaces this user's snapshot-less whitespace_sizing rows with a freshly
// computed set: one per eligible_not_owned eligibility cell.
// ---------------------------------------------------------------------------
router.post('/compute', authMiddleware, zValidator('json', computeSchema), async (c) => {
  const userId = getUserId(c)
  const { method } = c.req.valid('json')

  const [acctRows, prodRows, priceRows, seatRows, eligRows, ownRows] = await Promise.all([
    db.select().from(accounts).where(eq(accounts.user_id, userId)),
    db.select().from(products).where(eq(products.user_id, userId)),
    db.select().from(price_book).where(eq(price_book.user_id, userId)),
    db.select().from(seat_usage).where(eq(seat_usage.user_id, userId)),
    db.select().from(eligibility_cells).where(eq(eligibility_cells.user_id, userId)),
    db.select().from(ownership).where(eq(ownership.user_id, userId)),
  ])

  const acctById = new Map(acctRows.map((a) => [a.id, a]))
  const prodById = new Map(prodRows.map((p) => [p.id, p]))
  const ownedKeys = new Set(ownRows.map((o) => `${o.account_id}:${o.product_id}`))

  const priceByProduct = new Map<string, typeof priceRows>()
  for (const p of priceRows) {
    if (!p.is_active) continue
    const list = priceByProduct.get(p.product_id) ?? []
    list.push(p)
    priceByProduct.set(p.product_id, list)
  }

  const seatByKey = new Map<string, (typeof seatRows)[number]>()
  for (const s of seatRows) seatByKey.set(`${s.account_id}:${s.product_id}`, s)

  // Eligible targets: eligibility cells that mark the cell as buyable and not owned.
  const eligible = eligRows.filter(
    (e) =>
      (e.state === 'eligible_not_owned' || e.state === 'eligible') &&
      !ownedKeys.has(`${e.account_id}:${e.product_id}`),
  )

  // Wipe prior non-snapshot sizing for this user, then re-insert.
  await db.delete(whitespace_sizing).where(eq(whitespace_sizing.user_id, userId))

  let sized = 0
  let totalOpen = 0
  const computedAt = new Date()

  for (const cell of eligible) {
    const acct = acctById.get(cell.account_id)
    const prod = prodById.get(cell.product_id)
    if (!acct || !prod) continue
    const priceEntries = priceByProduct.get(cell.product_id) ?? []
    const seats = seatByKey.get(`${cell.account_id}:${cell.product_id}`)
    const { open, low, high, confidence } = sizeCell(method, acct, prod, priceEntries, seats)

    await db.insert(whitespace_sizing).values({
      user_id: userId,
      account_id: cell.account_id,
      product_id: cell.product_id,
      open_arr_cents: open,
      method,
      confidence,
      low_arr_cents: low,
      high_arr_cents: high,
      snapshot_id: null,
      computed_at: computedAt,
    })
    sized += 1
    totalOpen += open
  }

  return c.json({ sized, total_open_arr_cents: totalOpen, method })
})

export default router
