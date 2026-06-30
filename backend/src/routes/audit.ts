import { Hono } from 'hono'
import { db } from '../db/index.js'
import { audit_log } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { getUserId } from '../lib/auth.js'

const router = new Hono()

// Public: list audit log entries for the current user. Filters: entity, entity_id, action.
router.get('/', async (c) => {
  const userId = getUserId(c)
  if (!userId) return c.json([])

  const entity = c.req.query('entity')
  const entityId = c.req.query('entity_id')
  const action = c.req.query('action')
  const limitParam = parseInt(c.req.query('limit') ?? '200', 10)
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 1000) : 200

  const conds = [eq(audit_log.user_id, userId)]
  if (entity) conds.push(eq(audit_log.entity, entity))
  if (entityId) conds.push(eq(audit_log.entity_id, entityId))
  if (action) conds.push(eq(audit_log.action, action))

  const rows = await db
    .select()
    .from(audit_log)
    .where(and(...conds))
    .orderBy(desc(audit_log.created_at))
    .limit(limit)

  return c.json(rows)
})

export default router
