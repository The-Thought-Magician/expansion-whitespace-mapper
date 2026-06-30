import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { db } from '../db/index.js'
import { ownership, accounts, products } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const ownershipSchema = z.object({
  account_id: z.string().min(1),
  product_id: z.string().min(1),
  quantity: z.number().int().min(0).optional().default(1),
  owned_arr_cents: z.number().int().min(0).optional().default(0),
  owned_since: z.string().datetime().optional(),
})

// Public: list ownership cells (filter: account_id, product_id)
router.get('/', async (c) => {
  const accountId = c.req.query('account_id')
  const productId = c.req.query('product_id')
  const conds = []
  if (accountId) conds.push(eq(ownership.account_id, accountId))
  if (productId) conds.push(eq(ownership.product_id, productId))
  const rows = conds.length
    ? await db.select().from(ownership).where(and(...conds))
    : await db.select().from(ownership)
  return c.json(rows)
})

// Auth: upsert ownership cell (unique on account_id, product_id)
router.post('/', authMiddleware, zValidator('json', ownershipSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  // Ownership checks: account + product must belong to this user.
  const [acct] = await db.select().from(accounts).where(eq(accounts.id, body.account_id))
  if (!acct) return c.json({ error: 'Account not found' }, 404)
  if (acct.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const [prod] = await db.select().from(products).where(eq(products.id, body.product_id))
  if (!prod) return c.json({ error: 'Product not found' }, 404)
  if (prod.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const values = {
    user_id: userId,
    account_id: body.account_id,
    product_id: body.product_id,
    quantity: body.quantity ?? 1,
    owned_arr_cents: body.owned_arr_cents ?? 0,
    ...(body.owned_since ? { owned_since: new Date(body.owned_since) } : {}),
  }

  const [row] = await db
    .insert(ownership)
    .values(values)
    .onConflictDoUpdate({
      target: [ownership.account_id, ownership.product_id],
      set: {
        quantity: values.quantity,
        owned_arr_cents: values.owned_arr_cents,
        ...(body.owned_since ? { owned_since: new Date(body.owned_since) } : {}),
      },
    })
    .returning()
  return c.json(row, 201)
})

// Auth: delete ownership cell
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(ownership).where(eq(ownership.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(ownership).where(eq(ownership.id, id))
  return c.json({ success: true })
})

const importSchema = z.object({
  rows: z.array(
    z.object({
      account_id: z.string().min(1),
      product_id: z.string().min(1),
      quantity: z.number().int().min(0).optional(),
      owned_arr_cents: z.number().int().min(0).optional(),
      owned_since: z.string().datetime().optional(),
    }),
  ),
})

// Auth: bulk import ownership cells
router.post('/import', authMiddleware, zValidator('json', importSchema), async (c) => {
  const userId = getUserId(c)
  const { rows } = c.req.valid('json')

  // Resolve which accounts/products belong to this user once.
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
      await db
        .insert(ownership)
        .values({
          user_id: userId,
          account_id: r.account_id,
          product_id: r.product_id,
          quantity: r.quantity ?? 1,
          owned_arr_cents: r.owned_arr_cents ?? 0,
          ...(r.owned_since ? { owned_since: new Date(r.owned_since) } : {}),
        })
        .onConflictDoUpdate({
          target: [ownership.account_id, ownership.product_id],
          set: {
            quantity: r.quantity ?? 1,
            owned_arr_cents: r.owned_arr_cents ?? 0,
            ...(r.owned_since ? { owned_since: new Date(r.owned_since) } : {}),
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
