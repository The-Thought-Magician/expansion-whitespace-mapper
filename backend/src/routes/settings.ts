import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { org_settings, audit_log } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const DEFAULTS = {
  default_currency: 'USD',
  default_sizing_method: 'list_price',
  default_term: 'annual',
  settings: {} as Record<string, unknown>,
}

// Ensure a settings row exists for the user, returning it.
async function ensureSettings(userId: string) {
  const [existing] = await db
    .select()
    .from(org_settings)
    .where(eq(org_settings.user_id, userId))
  if (existing) return existing
  const [created] = await db
    .insert(org_settings)
    .values({ user_id: userId, ...DEFAULTS })
    .returning()
  return created
}

const settingsSchema = z.object({
  default_currency: z.string().min(1).max(8).optional(),
  default_sizing_method: z
    .enum(['list_price', 'per_seat', 'peer_median', 'default_expansion'])
    .optional(),
  default_term: z.enum(['monthly', 'quarterly', 'annual', 'multi_year']).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
})

// GET / — org settings for current user (auto-provisioned with defaults).
router.get('/', async (c) => {
  const userId = getUserId(c)
  if (!userId) {
    // Public read without a user resolves to bare defaults (no row written).
    return c.json({ ...DEFAULTS, id: null, user_id: null, updated_at: null })
  }
  const row = await ensureSettings(userId)
  return c.json(row)
})

// PUT / — update org settings.
router.put('/', authMiddleware, zValidator('json', settingsSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  await ensureSettings(userId)
  const patch: Record<string, unknown> = { updated_at: new Date() }
  if (body.default_currency !== undefined) patch.default_currency = body.default_currency
  if (body.default_sizing_method !== undefined)
    patch.default_sizing_method = body.default_sizing_method
  if (body.default_term !== undefined) patch.default_term = body.default_term
  if (body.settings !== undefined) patch.settings = body.settings
  const [updated] = await db
    .update(org_settings)
    .set(patch)
    .where(eq(org_settings.user_id, userId))
    .returning()
  await db.insert(audit_log).values({
    user_id: userId,
    entity: 'org_settings',
    entity_id: updated.id,
    action: 'update',
    detail: body as Record<string, unknown>,
  })
  return c.json(updated)
})

export default router
