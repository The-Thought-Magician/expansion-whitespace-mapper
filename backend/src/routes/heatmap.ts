import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  accounts,
  products,
  ownership,
  eligibility_cells,
  whitespace_sizing,
} from '../db/schema.js'
import { getUserId } from '../lib/auth.js'

const router = new Hono()

const UNSEGMENTED = 'Unsegmented'

// GET / — penetration matrix segment x product (adoption %)
// adoption % = owning accounts in segment / total accounts in segment, per product.
router.get('/', async (c) => {
  const userId = getUserId(c)

  const acctRows = await db.select().from(accounts).where(eq(accounts.user_id, userId))
  const productRows = await db
    .select()
    .from(products)
    .where(and(eq(products.user_id, userId), eq(products.is_active, true)))
  const ownershipRows = await db.select().from(ownership).where(eq(ownership.user_id, userId))

  // Segment -> set of account ids
  const segmentAccounts = new Map<string, Set<string>>()
  const acctSegment = new Map<string, string>()
  for (const a of acctRows) {
    const seg = a.segment ?? UNSEGMENTED
    acctSegment.set(a.id, seg)
    if (!segmentAccounts.has(seg)) segmentAccounts.set(seg, new Set())
    segmentAccounts.get(seg)!.add(a.id)
  }

  // (segment, product) -> count of distinct owning accounts
  const ownCount = new Map<string, number>()
  const seenOwnerPerCell = new Map<string, Set<string>>()
  for (const o of ownershipRows) {
    const seg = acctSegment.get(o.account_id)
    if (!seg) continue
    const key = `${seg}:${o.product_id}`
    let seen = seenOwnerPerCell.get(key)
    if (!seen) {
      seen = new Set()
      seenOwnerPerCell.set(key, seen)
    }
    if (seen.has(o.account_id)) continue
    seen.add(o.account_id)
    ownCount.set(key, (ownCount.get(key) ?? 0) + 1)
  }

  const segments = Array.from(segmentAccounts.keys()).sort((a, b) => a.localeCompare(b))
  const productList = productRows
    .map((p) => ({ id: p.id, name: p.name, sku_code: p.sku_code }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const cells: Array<{
    segment: string
    product_id: string
    total_accounts: number
    owning_accounts: number
    adoption_pct: number
  }> = []
  for (const seg of segments) {
    const total = segmentAccounts.get(seg)!.size
    for (const p of productList) {
      const owning = ownCount.get(`${seg}:${p.id}`) ?? 0
      const adoption = total > 0 ? owning / total : 0
      cells.push({
        segment: seg,
        product_id: p.id,
        total_accounts: total,
        owning_accounts: owning,
        adoption_pct: Math.round(adoption * 1000) / 10,
      })
    }
  }

  return c.json({
    segments: segments.map((name) => ({
      name,
      total_accounts: segmentAccounts.get(name)!.size,
    })),
    products: productList,
    cells,
  })
})

// GET /cell — eligible-not-owned accounts for a (segment, product)
router.get('/cell', async (c) => {
  const userId = getUserId(c)
  const segment = c.req.query('segment')
  const productId = c.req.query('product_id')
  if (!productId) return c.json({ error: 'product_id is required' }, 400)

  const acctRows = await db.select().from(accounts).where(eq(accounts.user_id, userId))
  const inSegment = acctRows.filter((a) =>
    segment ? (a.segment ?? UNSEGMENTED) === segment : true,
  )
  const segmentAcctIds = new Set(inSegment.map((a) => a.id))

  // Eligible-not-owned cells for this product.
  const eligCells = await db
    .select()
    .from(eligibility_cells)
    .where(
      and(
        eq(eligibility_cells.user_id, userId),
        eq(eligibility_cells.product_id, productId),
        eq(eligibility_cells.state, 'eligible_not_owned'),
      ),
    )

  const sizingRows = await db
    .select()
    .from(whitespace_sizing)
    .where(and(eq(whitespace_sizing.user_id, userId), eq(whitespace_sizing.product_id, productId)))
  const sizingMap = new Map(sizingRows.map((s) => [s.account_id, s.open_arr_cents]))

  const acctMap = new Map(inSegment.map((a) => [a.id, a]))
  const result = eligCells
    .filter((cell) => segmentAcctIds.has(cell.account_id))
    .map((cell) => {
      const account = acctMap.get(cell.account_id)!
      return {
        ...account,
        open_arr_cents: sizingMap.get(cell.account_id) ?? 0,
        reason: cell.reason,
      }
    })
    .sort((a, b) => b.open_arr_cents - a.open_arr_cents)

  return c.json(result)
})

export default router
