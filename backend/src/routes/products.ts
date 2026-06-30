import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { products, ownership, price_book, eligibility_rules } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const productSchema = z.object({
  sku_code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional().default(''),
  category: z.string().optional().nullable(),
  family: z.string().optional().nullable(),
  product_type: z.string().optional().default('flat_fee'),
  parent_product_id: z.string().optional().nullable(),
  is_active: z.boolean().optional().default(true),
  default_expansion_arr_cents: z.number().int().nonnegative().optional().default(0),
})

const importSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).min(1),
})

// ---------------------------------------------------------------------------
// GET / — list catalog with filters (public)
// ---------------------------------------------------------------------------
router.get('/', async (c) => {
  const userId = getUserId(c)
  const family = c.req.query('family')
  const category = c.req.query('category')
  const is_active = c.req.query('is_active')

  const conditions = [eq(products.user_id, userId)]
  if (family) conditions.push(eq(products.family, family))
  if (category) conditions.push(eq(products.category, category))
  if (is_active === 'true') conditions.push(eq(products.is_active, true))
  else if (is_active === 'false') conditions.push(eq(products.is_active, false))

  const rows = await db
    .select()
    .from(products)
    .where(and(...conditions))
    .orderBy(desc(products.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// GET /:id — product detail + child modules (public)
// ---------------------------------------------------------------------------
router.get('/:id', async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, id), eq(products.user_id, userId)))
  if (!product) return c.json({ error: 'Not found' }, 404)

  const modules = await db
    .select()
    .from(products)
    .where(
      and(eq(products.parent_product_id, id), eq(products.user_id, userId)),
    )
    .orderBy(desc(products.created_at))

  return c.json({ product, modules })
})

// ---------------------------------------------------------------------------
// POST / — create product (auth)
// ---------------------------------------------------------------------------
router.post('/', authMiddleware, zValidator('json', productSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  // If a parent is specified, it must belong to the same user.
  if (body.parent_product_id) {
    const [parent] = await db
      .select()
      .from(products)
      .where(eq(products.id, body.parent_product_id))
    if (!parent || parent.user_id !== userId) {
      return c.json({ error: 'Invalid parent_product_id' }, 400)
    }
  }

  const [created] = await db
    .insert(products)
    .values({
      user_id: userId,
      sku_code: body.sku_code,
      name: body.name,
      description: body.description ?? '',
      category: body.category ?? null,
      family: body.family ?? null,
      product_type: body.product_type ?? 'flat_fee',
      parent_product_id: body.parent_product_id ?? null,
      is_active: body.is_active ?? true,
      default_expansion_arr_cents: body.default_expansion_arr_cents ?? 0,
    })
    .returning()
  return c.json(created, 201)
})

// ---------------------------------------------------------------------------
// PUT /:id — update product (auth + ownership)
// ---------------------------------------------------------------------------
router.put(
  '/:id',
  authMiddleware,
  zValidator('json', productSchema.partial()),
  async (c) => {
    const userId = getUserId(c)
    const id = c.req.param('id')
    const [existing] = await db.select().from(products).where(eq(products.id, id))
    if (!existing) return c.json({ error: 'Not found' }, 404)
    if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

    const body = c.req.valid('json')
    if (body.parent_product_id) {
      if (body.parent_product_id === id) {
        return c.json({ error: 'A product cannot be its own parent' }, 400)
      }
      const [parent] = await db
        .select()
        .from(products)
        .where(eq(products.id, body.parent_product_id))
      if (!parent || parent.user_id !== userId) {
        return c.json({ error: 'Invalid parent_product_id' }, 400)
      }
    }

    const [updated] = await db
      .update(products)
      .set({ ...body, updated_at: new Date() })
      .where(eq(products.id, id))
      .returning()
    return c.json(updated)
  },
)

// ---------------------------------------------------------------------------
// DELETE /:id — retire (if referenced) or hard-delete product (auth + ownership)
// ---------------------------------------------------------------------------
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(products).where(eq(products.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  // If referenced by ownership / price book / rules / child modules, soft-retire
  // (is_active=false) rather than break referential integrity.
  const [ownedRef] = await db
    .select()
    .from(ownership)
    .where(eq(ownership.product_id, id))
    .limit(1)
  const [priceRef] = await db
    .select()
    .from(price_book)
    .where(eq(price_book.product_id, id))
    .limit(1)
  const [childRef] = await db
    .select()
    .from(products)
    .where(eq(products.parent_product_id, id))
    .limit(1)
  const [ruleRef] = await db
    .select()
    .from(eligibility_rules)
    .where(eq(eligibility_rules.target_product_id, id))
    .limit(1)

  if (ownedRef || priceRef || childRef || ruleRef) {
    const [retired] = await db
      .update(products)
      .set({ is_active: false, updated_at: new Date() })
      .where(eq(products.id, id))
      .returning()
    return c.json({ success: true, retired: true, product: retired })
  }

  await db.delete(products).where(eq(products.id, id))
  return c.json({ success: true, retired: false })
})

// ---------------------------------------------------------------------------
// POST /import — bulk import catalog rows (auth)
// ---------------------------------------------------------------------------
router.post('/import', authMiddleware, zValidator('json', importSchema), async (c) => {
  const userId = getUserId(c)
  const { rows } = c.req.valid('json')
  let imported = 0
  const errors: Array<{ row: number; error: string }> = []

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i]
    const parsed = productSchema.safeParse({
      sku_code: raw.sku_code,
      name: raw.name,
      description: raw.description ?? '',
      category: raw.category ?? null,
      family: raw.family ?? null,
      product_type: raw.product_type ?? 'flat_fee',
      parent_product_id: raw.parent_product_id ?? null,
      is_active: raw.is_active ?? true,
      default_expansion_arr_cents:
        typeof raw.default_expansion_arr_cents === 'number'
          ? raw.default_expansion_arr_cents
          : 0,
    })
    if (!parsed.success) {
      errors.push({ row: i, error: parsed.error.issues[0]?.message ?? 'Invalid row' })
      continue
    }
    const v = parsed.data
    try {
      await db
        .insert(products)
        .values({
          user_id: userId,
          sku_code: v.sku_code,
          name: v.name,
          description: v.description ?? '',
          category: v.category ?? null,
          family: v.family ?? null,
          product_type: v.product_type ?? 'flat_fee',
          parent_product_id: v.parent_product_id ?? null,
          is_active: v.is_active ?? true,
          default_expansion_arr_cents: v.default_expansion_arr_cents ?? 0,
        })
        .onConflictDoUpdate({
          target: [products.user_id, products.sku_code],
          set: {
            name: v.name,
            description: v.description ?? '',
            category: v.category ?? null,
            family: v.family ?? null,
            product_type: v.product_type ?? 'flat_fee',
            parent_product_id: v.parent_product_id ?? null,
            is_active: v.is_active ?? true,
            default_expansion_arr_cents: v.default_expansion_arr_cents ?? 0,
            updated_at: new Date(),
          },
        })
      imported++
    } catch (e) {
      errors.push({ row: i, error: e instanceof Error ? e.message : String(e) })
    }
  }

  return c.json({ imported, errors })
})

export default router
