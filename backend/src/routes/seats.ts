import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { db } from '../db/index.js'
import { seat_usage, accounts, products, price_book } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// Derive penetration / assignment ratios for a seat-usage row.
function withRatios(row: typeof seat_usage.$inferSelect) {
  const licensed = row.licensed_seats || 0
  const active = row.active_seats || 0
  const assigned = row.assigned_seats || 0
  const penetration = licensed > 0 ? active / licensed : 0
  const assigned_ratio = licensed > 0 ? assigned / licensed : 0
  const open_seats = Math.max(0, licensed - active)
  const overage_seats = Math.max(0, active - licensed)
  return {
    ...row,
    penetration,
    assigned_ratio,
    open_seats,
    overage_seats,
  }
}

// Public: list seat usage with penetration ratios (filter: account_id, product_id)
router.get('/', async (c) => {
  const accountId = c.req.query('account_id')
  const productId = c.req.query('product_id')
  const conds = []
  if (accountId) conds.push(eq(seat_usage.account_id, accountId))
  if (productId) conds.push(eq(seat_usage.product_id, productId))
  const rows = conds.length
    ? await db.select().from(seat_usage).where(and(...conds))
    : await db.select().from(seat_usage)
  return c.json(rows.map(withRatios))
})

// Public: accounts where active > licensed, sized as an upsell.
router.get('/overage', async (c) => {
  const userId = c.req.header('X-User-Id') ?? c.req.header('x-user-id')
  const rows = userId
    ? await db.select().from(seat_usage).where(eq(seat_usage.user_id, userId))
    : await db.select().from(seat_usage)

  const overRows = rows.filter((r) => (r.active_seats || 0) > (r.licensed_seats || 0))
  if (overRows.length === 0) return c.json([])

  // Pull per-seat prices to size each overage; fall back to product default.
  const productIds = Array.from(new Set(overRows.map((r) => r.product_id)))
  const prodList = productIds.length
    ? await db.select().from(products)
    : []
  const prodById = new Map(prodList.map((p) => [p.id, p]))
  const prices = await db.select().from(price_book)
  const perSeatByProduct = new Map<string, number>()
  for (const p of prices) {
    if (!p.is_active) continue
    if (p.per_seat_cents > 0 && !perSeatByProduct.has(p.product_id)) {
      perSeatByProduct.set(p.product_id, p.per_seat_cents)
    }
  }

  const out = overRows.map((r) => {
    const overageSeats = (r.active_seats || 0) - (r.licensed_seats || 0)
    const perSeat = perSeatByProduct.get(r.product_id) ?? 0
    const prod = prodById.get(r.product_id)
    const sizedFromSeats = overageSeats * perSeat
    const sized_arr_cents = sizedFromSeats > 0
      ? sizedFromSeats
      : (prod?.default_expansion_arr_cents ?? 0)
    return {
      ...withRatios(r),
      overage_seats: overageSeats,
      per_seat_cents: perSeat,
      sized_arr_cents,
    }
  })
  return c.json(out)
})

const seatSchema = z.object({
  account_id: z.string().min(1),
  product_id: z.string().min(1),
  licensed_seats: z.number().int().min(0).optional().default(0),
  active_seats: z.number().int().min(0).optional().default(0),
  assigned_seats: z.number().int().min(0).optional().default(0),
  as_of: z.string().datetime().optional(),
})

// Auth: upsert seat usage record (unique on account_id, product_id)
router.post('/', authMiddleware, zValidator('json', seatSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  const [acct] = await db.select().from(accounts).where(eq(accounts.id, body.account_id))
  if (!acct) return c.json({ error: 'Account not found' }, 404)
  if (acct.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const [prod] = await db.select().from(products).where(eq(products.id, body.product_id))
  if (!prod) return c.json({ error: 'Product not found' }, 404)
  if (prod.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const set = {
    licensed_seats: body.licensed_seats ?? 0,
    active_seats: body.active_seats ?? 0,
    assigned_seats: body.assigned_seats ?? 0,
    ...(body.as_of ? { as_of: new Date(body.as_of) } : {}),
  }

  const [row] = await db
    .insert(seat_usage)
    .values({
      user_id: userId,
      account_id: body.account_id,
      product_id: body.product_id,
      ...set,
    })
    .onConflictDoUpdate({
      target: [seat_usage.account_id, seat_usage.product_id],
      set,
    })
    .returning()
  return c.json(withRatios(row), 201)
})

const importSchema = z.object({
  rows: z.array(
    z.object({
      account_id: z.string().min(1),
      product_id: z.string().min(1),
      licensed_seats: z.number().int().min(0).optional(),
      active_seats: z.number().int().min(0).optional(),
      assigned_seats: z.number().int().min(0).optional(),
      as_of: z.string().datetime().optional(),
    }),
  ),
})

// Auth: bulk import seat usage
router.post('/import', authMiddleware, zValidator('json', importSchema), async (c) => {
  const userId = getUserId(c)
  const { rows } = c.req.valid('json')

  const userAccounts = await db.select().from(accounts).where(eq(accounts.user_id, userId))
  const userProducts = await db.select().from(products).where(eq(products.user_id, userId))
  const accountIds = new Set(userAccounts.map((a) => a.id))
  const productIds = new Set(userProducts.map((p) => p.id))

  let imported = 0
  const errors: Array<Record<string, unknown>> = []

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (!accountIds.has(r.account_id)) {
      errors.push({ row: i, error: `Unknown or unauthorized account_id: ${r.account_id}` })
      continue
    }
    if (!productIds.has(r.product_id)) {
      errors.push({ row: i, error: `Unknown or unauthorized product_id: ${r.product_id}` })
      continue
    }
    try {
      const set = {
        licensed_seats: r.licensed_seats ?? 0,
        active_seats: r.active_seats ?? 0,
        assigned_seats: r.assigned_seats ?? 0,
        ...(r.as_of ? { as_of: new Date(r.as_of) } : {}),
      }
      await db
        .insert(seat_usage)
        .values({ user_id: userId, account_id: r.account_id, product_id: r.product_id, ...set })
        .onConflictDoUpdate({
          target: [seat_usage.account_id, seat_usage.product_id],
          set,
        })
      imported++
    } catch (e) {
      errors.push({ row: i, error: e instanceof Error ? e.message : String(e) })
    }
  }

  return c.json({ imported, errors })
})

export default router
