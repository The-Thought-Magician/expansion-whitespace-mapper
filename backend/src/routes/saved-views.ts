import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { saved_views } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const savedViewSchema = z.object({
  name: z.string().min(1),
  surface: z.string().min(1).default('grid'),
  filters: z.record(z.string(), z.unknown()).default({}),
  is_shared: z.boolean().default(false),
})

// Public: list saved views (optional filter: surface). Returns own + shared views.
router.get('/', async (c) => {
  const userId = getUserId(c)
  const surface = c.req.query('surface')
  const conds = []
  if (userId) conds.push(eq(saved_views.user_id, userId))
  if (surface) conds.push(eq(saved_views.surface, surface))
  const where = conds.length ? and(...conds) : undefined
  const rows = await db
    .select()
    .from(saved_views)
    .where(where)
    .orderBy(desc(saved_views.created_at))
  return c.json(rows)
})

// Auth-gated: create a saved view for the current user.
router.post('/', authMiddleware, zValidator('json', savedViewSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [created] = await db
    .insert(saved_views)
    .values({
      user_id: userId,
      name: body.name,
      surface: body.surface,
      filters: body.filters,
      is_shared: body.is_shared,
    })
    .onConflictDoUpdate({
      target: [saved_views.user_id, saved_views.name],
      set: { surface: body.surface, filters: body.filters, is_shared: body.is_shared },
    })
    .returning()
  return c.json(created, 201)
})

// Auth-gated: delete an owned saved view.
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(saved_views).where(eq(saved_views.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(saved_views).where(eq(saved_views.id, id))
  return c.json({ success: true })
})

export default router
