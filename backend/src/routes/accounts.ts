import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  accounts,
  ownership,
  products,
  whitespace_sizing,
  seat_usage,
  plays,
  lookalike_suggestions,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const accountSchema = z.object({
  external_id: z.string().optional().nullable(),
  name: z.string().min(1),
  segment: z.string().optional().nullable(),
  industry: z.string().optional().nullable(),
  region: z.string().optional().nullable(),
  employee_band: z.string().optional().nullable(),
  plan_tier: z.string().optional().nullable(),
  csm_owner: z.string().optional().nullable(),
  current_arr_cents: z.number().int().nonnegative().optional().default(0),
  attributes: z.record(z.string(), z.unknown()).optional().default({}),
})

// ---------------------------------------------------------------------------
// GET / — list accounts with optional filters (public)
// ---------------------------------------------------------------------------
router.get('/', async (c) => {
  const userId = getUserId(c)
  const segment = c.req.query('segment')
  const csm_owner = c.req.query('csm_owner')
  const region = c.req.query('region')
  const industry = c.req.query('industry')

  const conditions = [eq(accounts.user_id, userId)]
  if (segment) conditions.push(eq(accounts.segment, segment))
  if (csm_owner) conditions.push(eq(accounts.csm_owner, csm_owner))
  if (region) conditions.push(eq(accounts.region, region))
  if (industry) conditions.push(eq(accounts.industry, industry))

  const rows = await db
    .select()
    .from(accounts)
    .where(and(...conditions))
    .orderBy(desc(accounts.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// GET /:id — account detail with rollups (public)
// ---------------------------------------------------------------------------
router.get('/:id', async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.user_id, userId)))
  if (!account) return c.json({ error: 'Not found' }, 404)

  // Owned products (join ownership x products)
  const ownedRows = await db
    .select()
    .from(ownership)
    .where(and(eq(ownership.account_id, id), eq(ownership.user_id, userId)))

  const productIds = ownedRows.map((o) => o.product_id)
  const allProducts = await db
    .select()
    .from(products)
    .where(eq(products.user_id, userId))
  const productMap = new Map(allProducts.map((p) => [p.id, p]))

  const owned = ownedRows.map((o) => ({
    ...o,
    product: productMap.get(o.product_id) ?? null,
  }))
  const ownedProductIds = new Set(productIds)

  // Whitespace sizing for this account (latest per cell)
  const sizingRows = await db
    .select()
    .from(whitespace_sizing)
    .where(and(eq(whitespace_sizing.account_id, id), eq(whitespace_sizing.user_id, userId)))
    .orderBy(desc(whitespace_sizing.computed_at))
  const seenSizing = new Set<string>()
  const whitespace: typeof sizingRows = []
  let total_open_arr_cents = 0
  for (const s of sizingRows) {
    if (seenSizing.has(s.product_id)) continue
    seenSizing.add(s.product_id)
    whitespace.push({ ...s, product: productMap.get(s.product_id) ?? null } as any)
    total_open_arr_cents += s.open_arr_cents
  }

  // Seat penetration
  const seatRows = await db
    .select()
    .from(seat_usage)
    .where(and(eq(seat_usage.account_id, id), eq(seat_usage.user_id, userId)))
  const seats = seatRows.map((s) => {
    const penetration =
      s.licensed_seats > 0 ? s.active_seats / s.licensed_seats : 0
    return {
      ...s,
      product: productMap.get(s.product_id) ?? null,
      penetration_pct: Math.round(penetration * 1000) / 10,
      is_overage: s.active_seats > s.licensed_seats,
    }
  })

  // Plays for this account
  const playRows = await db
    .select()
    .from(plays)
    .where(and(eq(plays.account_id, id), eq(plays.user_id, userId)))
    .orderBy(desc(plays.created_at))
  const playsOut = playRows.map((p) => ({
    ...p,
    product: productMap.get(p.product_id) ?? null,
  }))

  // Lookalike suggestions for this account
  const lookalikeRows = await db
    .select()
    .from(lookalike_suggestions)
    .where(
      and(
        eq(lookalike_suggestions.account_id, id),
        eq(lookalike_suggestions.user_id, userId),
      ),
    )
    .orderBy(desc(lookalike_suggestions.score))
  const lookalikes = lookalikeRows.map((l) => ({
    ...l,
    product: productMap.get(l.product_id) ?? null,
  }))

  const total_owned_arr_cents = ownedRows.reduce(
    (sum, o) => sum + o.owned_arr_cents,
    0,
  )

  return c.json({
    account,
    owned,
    whitespace,
    seats,
    plays: playsOut,
    lookalikes,
    rollups: {
      owned_product_count: ownedProductIds.size,
      total_owned_arr_cents,
      total_open_arr_cents,
      open_play_count: playRows.filter(
        (p) => p.stage !== 'won' && p.stage !== 'lost',
      ).length,
      lookalike_count: lookalikeRows.length,
    },
  })
})

// ---------------------------------------------------------------------------
// POST / — create account (auth)
// ---------------------------------------------------------------------------
router.post('/', authMiddleware, zValidator('json', accountSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [created] = await db
    .insert(accounts)
    .values({
      user_id: userId,
      external_id: body.external_id ?? null,
      name: body.name,
      segment: body.segment ?? null,
      industry: body.industry ?? null,
      region: body.region ?? null,
      employee_band: body.employee_band ?? null,
      plan_tier: body.plan_tier ?? null,
      csm_owner: body.csm_owner ?? null,
      current_arr_cents: body.current_arr_cents ?? 0,
      attributes: body.attributes ?? {},
    })
    .returning()
  return c.json(created, 201)
})

// ---------------------------------------------------------------------------
// PUT /:id — update account (auth + ownership)
// ---------------------------------------------------------------------------
router.put(
  '/:id',
  authMiddleware,
  zValidator('json', accountSchema.partial()),
  async (c) => {
    const userId = getUserId(c)
    const id = c.req.param('id')
    const [existing] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, id))
    if (!existing) return c.json({ error: 'Not found' }, 404)
    if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

    const body = c.req.valid('json')
    const [updated] = await db
      .update(accounts)
      .set({ ...body, updated_at: new Date() })
      .where(eq(accounts.id, id))
      .returning()
    return c.json(updated)
  },
)

// ---------------------------------------------------------------------------
// DELETE /:id — delete account + dependent rows (auth + ownership)
// ---------------------------------------------------------------------------
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(accounts).where(eq(accounts.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  // Remove dependent rows that reference this account to avoid FK orphans.
  await db.delete(ownership).where(eq(ownership.account_id, id))
  await db.delete(seat_usage).where(eq(seat_usage.account_id, id))
  await db.delete(whitespace_sizing).where(eq(whitespace_sizing.account_id, id))
  await db
    .delete(lookalike_suggestions)
    .where(eq(lookalike_suggestions.account_id, id))
  await db.delete(plays).where(eq(plays.account_id, id))
  await db.delete(accounts).where(eq(accounts.id, id))
  return c.json({ success: true })
})

export default router
