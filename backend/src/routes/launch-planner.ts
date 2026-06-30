import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { accounts, products, price_book, ownership } from '../db/schema.js'
import { eq, and } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// A single launch-condition: attribute comparison over the account row.
const conditionSchema = z.object({
  field: z.string().min(1),
  op: z.enum(['eq', 'neq', 'in', 'gte', 'lte']).default('eq'),
  value: z.union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))]),
})

const modelSchema = z.object({
  target_product_id: z.string().min(1),
  mode: z.enum(['all_match', 'any_match']).optional().default('all_match'),
  conditions: z.array(conditionSchema).optional().default([]),
  // Pricing assumptions for the modeled launch.
  method: z.enum(['list_price', 'default_expansion', 'per_seat']).optional().default('list_price'),
  segment: z.string().optional(),
  // Fallback per-account ARR (cents) when no price-book entry resolves.
  fallback_arr_cents: z.number().int().nonnegative().optional().default(0),
  // Optional assumed seat count for per_seat pricing.
  assumed_seats: z.number().int().positive().optional().default(1),
})

type AccountRow = typeof accounts.$inferSelect

function getField(acct: AccountRow, field: string): unknown {
  switch (field) {
    case 'segment':
      return acct.segment
    case 'industry':
      return acct.industry
    case 'region':
      return acct.region
    case 'employee_band':
      return acct.employee_band
    case 'plan_tier':
      return acct.plan_tier
    case 'csm_owner':
      return acct.csm_owner
    case 'current_arr_cents':
      return acct.current_arr_cents
    default: {
      const attrs = (acct.attributes ?? {}) as Record<string, unknown>
      return attrs[field]
    }
  }
}

function matchCondition(acct: AccountRow, cond: z.infer<typeof conditionSchema>): boolean {
  const actual = getField(acct, cond.field)
  switch (cond.op) {
    case 'eq':
      return String(actual) === String(cond.value)
    case 'neq':
      return String(actual) !== String(cond.value)
    case 'in':
      return Array.isArray(cond.value) && cond.value.map(String).includes(String(actual))
    case 'gte':
      return typeof actual === 'number' && typeof cond.value === 'number' && actual >= cond.value
    case 'lte':
      return typeof actual === 'number' && typeof cond.value === 'number' && actual <= cond.value
    default:
      return false
  }
}

// POST /model — model a launch: target product + eligibility => addressable whitespace ARR
router.post('/model', authMiddleware, zValidator('json', modelSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, body.target_product_id), eq(products.user_id, userId)))
  if (!product) return c.json({ error: 'Target product not found' }, 404)

  const allAccounts = await db.select().from(accounts).where(eq(accounts.user_id, userId))

  // Accounts that already own the target product are excluded from whitespace.
  const owners = await db
    .select()
    .from(ownership)
    .where(and(eq(ownership.user_id, userId), eq(ownership.product_id, body.target_product_id)))
  const ownerAccountIds = new Set(owners.map((o) => o.account_id))

  // Resolve a price-book entry for pricing (optionally segment-scoped).
  const priceRows = await db
    .select()
    .from(price_book)
    .where(and(eq(price_book.user_id, userId), eq(price_book.product_id, body.target_product_id)))
  const activePrices = priceRows.filter((p) => p.is_active)

  function priceForAccount(acct: AccountRow): number {
    if (body.method === 'default_expansion') {
      return product.default_expansion_arr_cents || body.fallback_arr_cents
    }
    // Prefer a price-book entry matching the account's segment, else any active one.
    const seg = body.segment ?? acct.segment ?? null
    const matched =
      activePrices.find((p) => seg != null && p.segment === seg) ??
      activePrices.find((p) => p.segment == null) ??
      activePrices[0]
    if (!matched) {
      return product.default_expansion_arr_cents || body.fallback_arr_cents
    }
    if (body.method === 'per_seat') {
      const seats = body.assumed_seats
      const perSeat = matched.per_seat_cents || 0
      if (perSeat > 0) return perSeat * seats
    }
    if (matched.list_price_cents > 0) return matched.list_price_cents
    if (matched.per_seat_cents > 0) return matched.per_seat_cents * body.assumed_seats
    return product.default_expansion_arr_cents || body.fallback_arr_cents
  }

  let addressable = 0
  let eligibleCount = 0
  const eligibleAccountIds: string[] = []
  // Pre vs post: pre = current_arr the account already pays; post = pre + modeled whitespace.
  const byPre = new Map<string, { band: string; accounts: number; arr_cents: number }>()
  const byPost = new Map<string, { band: string; accounts: number; arr_cents: number }>()

  function band(arrCents: number): string {
    if (arrCents <= 0) return 'none'
    if (arrCents < 1_000_000) return 'under_10k'
    if (arrCents < 5_000_000) return '10k_50k'
    if (arrCents < 10_000_000) return '50k_100k'
    return 'over_100k'
  }

  function addBand(
    map: Map<string, { band: string; accounts: number; arr_cents: number }>,
    key: string,
    arr: number,
  ) {
    let e = map.get(key)
    if (!e) {
      e = { band: key, accounts: 0, arr_cents: 0 }
      map.set(key, e)
    }
    e.accounts += 1
    e.arr_cents += arr
  }

  for (const acct of allAccounts) {
    if (ownerAccountIds.has(acct.id)) continue
    const conds = body.conditions
    let eligible: boolean
    if (conds.length === 0) {
      eligible = true
    } else if (body.mode === 'any_match') {
      eligible = conds.some((cond) => matchCondition(acct, cond))
    } else {
      eligible = conds.every((cond) => matchCondition(acct, cond))
    }
    if (!eligible) continue

    const whitespace = priceForAccount(acct)
    addressable += whitespace
    eligibleCount += 1
    eligibleAccountIds.push(acct.id)

    const preArr = acct.current_arr_cents
    const postArr = preArr + whitespace
    addBand(byPre, band(preArr), preArr)
    addBand(byPost, band(postArr), postArr)
  }

  const sortBand = (a: { arr_cents: number }, b: { arr_cents: number }) => b.arr_cents - a.arr_cents

  return c.json({
    addressable_arr_cents: addressable,
    eligible_accounts: eligibleCount,
    eligible_account_ids: eligibleAccountIds,
    target_product: { id: product.id, name: product.name, sku_code: product.sku_code },
    method: body.method,
    byPre: Array.from(byPre.values()).sort(sortBand),
    byPost: Array.from(byPost.values()).sort(sortBand),
  })
})

export default router
