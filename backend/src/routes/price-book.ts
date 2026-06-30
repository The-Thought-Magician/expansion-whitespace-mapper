import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { price_book, products } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const priceSchema = z.object({
  product_id: z.string().min(1),
  segment: z.string().optional().nullable(),
  currency: z.string().optional().default('USD'),
  term: z.string().optional().default('annual'),
  list_price_cents: z.number().int().nonnegative().optional().default(0),
  per_seat_cents: z.number().int().nonnegative().optional().default(0),
  seat_band_min: z.number().int().nonnegative().optional().default(1),
  seat_band_max: z.number().int().nonnegative().optional().nullable(),
  effective_from: z.string().datetime().optional(),
  is_active: z.boolean().optional().default(true),
})

// ---------------------------------------------------------------------------
// GET / — list price entries with filters (public)
//   Returns effective-dated entries ordered newest-effective first so callers
//   can pick the currently-effective row per product/segment.
// ---------------------------------------------------------------------------
router.get('/', async (c) => {
  const userId = getUserId(c)
  const product_id = c.req.query('product_id')
  const segment = c.req.query('segment')

  const conditions = [eq(price_book.user_id, userId)]
  if (product_id) conditions.push(eq(price_book.product_id, product_id))
  if (segment) conditions.push(eq(price_book.segment, segment))

  const rows = await db
    .select()
    .from(price_book)
    .where(and(...conditions))
    .orderBy(desc(price_book.effective_from))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// POST / — create price entry (auth, product ownership check)
// ---------------------------------------------------------------------------
router.post('/', authMiddleware, zValidator('json', priceSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  const [product] = await db
    .select()
    .from(products)
    .where(eq(products.id, body.product_id))
  if (!product || product.user_id !== userId) {
    return c.json({ error: 'Invalid product_id' }, 400)
  }

  const [created] = await db
    .insert(price_book)
    .values({
      user_id: userId,
      product_id: body.product_id,
      segment: body.segment ?? null,
      currency: body.currency ?? 'USD',
      term: body.term ?? 'annual',
      list_price_cents: body.list_price_cents ?? 0,
      per_seat_cents: body.per_seat_cents ?? 0,
      seat_band_min: body.seat_band_min ?? 1,
      seat_band_max: body.seat_band_max ?? null,
      effective_from: body.effective_from ? new Date(body.effective_from) : new Date(),
      is_active: body.is_active ?? true,
    })
    .returning()
  return c.json(created, 201)
})

// ---------------------------------------------------------------------------
// PUT /:id — update price entry (auth + ownership)
// ---------------------------------------------------------------------------
router.put(
  '/:id',
  authMiddleware,
  zValidator('json', priceSchema.partial()),
  async (c) => {
    const userId = getUserId(c)
    const id = c.req.param('id')
    const [existing] = await db
      .select()
      .from(price_book)
      .where(eq(price_book.id, id))
    if (!existing) return c.json({ error: 'Not found' }, 404)
    if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

    const body = c.req.valid('json')
    if (body.product_id && body.product_id !== existing.product_id) {
      const [product] = await db
        .select()
        .from(products)
        .where(eq(products.id, body.product_id))
      if (!product || product.user_id !== userId) {
        return c.json({ error: 'Invalid product_id' }, 400)
      }
    }

    const { effective_from, ...rest } = body
    const setValues: Record<string, unknown> = { ...rest }
    if (effective_from) setValues.effective_from = new Date(effective_from)

    const [updated] = await db
      .update(price_book)
      .set(setValues)
      .where(eq(price_book.id, id))
      .returning()
    return c.json(updated)
  },
)

// ---------------------------------------------------------------------------
// DELETE /:id — delete price entry (auth + ownership)
// ---------------------------------------------------------------------------
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(price_book)
    .where(eq(price_book.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  await db.delete(price_book).where(eq(price_book.id, id))
  return c.json({ success: true })
})

export default router
