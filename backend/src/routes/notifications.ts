import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { streamSSE } from 'hono/streaming'
import { db } from '../db/index.js'
import { notifications, trigger_rules } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'
import {
  validateExpression,
  describeExpression,
  nextFirings,
  computeCollisions,
  loadHeatmap,
  dstTraps,
  coverageGaps,
  autoSpread,
  type ScheduleKind,
  type ScheduledJob,
} from '../lib/cron.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Helpers: trigger_rules carry an optional schedule in conditions.schedule.
// Shape: { schedule: { kind: 'cron'|'rate'|'oneoff', expr: string, timezone?: string,
//          resourceId?: string }, ...other matcher conditions }
// We project these into the cron engine's ScheduledJob type so the scheduling
// analytics (firings/collisions/heatmap/dst/coverage/optimizer) operate over the
// user's real trigger rules.
// ---------------------------------------------------------------------------

interface RuleSchedule {
  kind: ScheduleKind
  expr: string
  timezone?: string
  resourceId?: string | null
}

type TriggerRow = typeof trigger_rules.$inferSelect

function extractSchedule(row: TriggerRow): RuleSchedule | null {
  const conds = (row.conditions ?? {}) as Record<string, unknown>
  const s = conds.schedule as Record<string, unknown> | undefined
  if (!s || typeof s !== 'object') return null
  const kind = s.kind as ScheduleKind | undefined
  const expr = s.expr as string | undefined
  if (!kind || !expr) return null
  return {
    kind,
    expr,
    timezone: typeof s.timezone === 'string' ? s.timezone : undefined,
    resourceId: typeof s.resourceId === 'string' ? s.resourceId : null,
  }
}

function toScheduledJob(row: TriggerRow): ScheduledJob | null {
  const sched = extractSchedule(row)
  if (!sched) return null
  return {
    id: row.id,
    kind: sched.kind,
    expr: sched.expr,
    timezone: sched.timezone ?? 'UTC',
    resourceId: sched.resourceId ?? null,
  }
}

async function scheduledJobsForUser(userId: string): Promise<ScheduledJob[]> {
  const rows = await db.select().from(trigger_rules).where(eq(trigger_rules.user_id, userId))
  return rows.map(toScheduledJob).filter((j): j is ScheduledJob => j !== null)
}

// ---------------------------------------------------------------------------
// Notification feed
// ---------------------------------------------------------------------------

// GET / — current user notification feed
router.get('/', async (c) => {
  const userId = getUserId(c)
  if (!userId) return c.json([])
  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.user_id, userId))
    .orderBy(desc(notifications.created_at))
  return c.json(rows)
})

// POST /:id/read — mark read
router.post('/:id/read', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(notifications).where(eq(notifications.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const [updated] = await db
    .update(notifications)
    .set({ is_read: true })
    .where(eq(notifications.id, id))
    .returning()
  return c.json(updated)
})

// POST /read-all — mark all read
router.post('/read-all', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const updated = await db
    .update(notifications)
    .set({ is_read: true })
    .where(and(eq(notifications.user_id, userId), eq(notifications.is_read, false)))
    .returning()
  return c.json({ updated: updated.length })
})

// ---------------------------------------------------------------------------
// Trigger-rule CRUD
// ---------------------------------------------------------------------------

const scheduleSchema = z.object({
  kind: z.enum(['cron', 'rate', 'oneoff']),
  expr: z.string().min(1),
  timezone: z.string().optional(),
  resourceId: z.string().optional(),
})

const triggerSchema = z.object({
  name: z.string().min(1),
  event_type: z.string().min(1),
  conditions: z.record(z.unknown()).optional().default({}),
  is_active: z.boolean().optional().default(true),
  schedule: scheduleSchema.optional(),
})

// GET /triggers — list trigger rules
router.get('/triggers', async (c) => {
  const userId = getUserId(c)
  if (!userId) return c.json([])
  const rows = await db
    .select()
    .from(trigger_rules)
    .where(eq(trigger_rules.user_id, userId))
    .orderBy(desc(trigger_rules.created_at))
  // Decorate each rule with a human-readable schedule description + next firings.
  const decorated = rows.map((r) => {
    const sched = extractSchedule(r)
    return {
      ...r,
      schedule: sched,
      schedule_description: sched ? describeExpression(sched.kind, sched.expr, sched.timezone ?? 'UTC') : null,
      next_firings: sched ? nextFirings(sched.kind, sched.expr, sched.timezone ?? 'UTC', new Date().toISOString(), 5) : [],
    }
  })
  return c.json(decorated)
})

// POST /triggers — create trigger rule
router.post('/triggers', authMiddleware, zValidator('json', triggerSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  // Fold an optional schedule into the conditions jsonb, validating its expression.
  const conditions: Record<string, unknown> = { ...body.conditions }
  if (body.schedule) {
    const v = validateExpression(body.schedule.kind, body.schedule.expr)
    if (!v.valid) return c.json({ error: `Invalid schedule expression: ${v.error}` }, 400)
    conditions.schedule = body.schedule
  }

  const [created] = await db
    .insert(trigger_rules)
    .values({
      user_id: userId,
      name: body.name,
      event_type: body.event_type,
      conditions,
      is_active: body.is_active,
    })
    .returning()
  return c.json(created, 201)
})

// DELETE /triggers/:id — delete trigger rule
router.delete('/triggers/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(trigger_rules).where(eq(trigger_rules.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(trigger_rules).where(eq(trigger_rules.id, id))
  return c.json({ success: true })
})

// ---------------------------------------------------------------------------
// Scheduling analytics over the user's trigger rules (cron engine)
// ---------------------------------------------------------------------------

// GET /triggers/:id/firings — next N projected firings for one rule
router.get('/triggers/:id/firings', async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [rule] = await db.select().from(trigger_rules).where(eq(trigger_rules.id, id))
  if (!rule) return c.json({ error: 'Not found' }, 404)
  if (userId && rule.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const sched = extractSchedule(rule)
  if (!sched) return c.json({ schedule: null, firings: [] })
  const count = Math.min(50, Math.max(1, parseInt(c.req.query('count') ?? '10', 10) || 10))
  const tz = sched.timezone ?? 'UTC'
  return c.json({
    schedule: sched,
    description: describeExpression(sched.kind, sched.expr, tz),
    valid: validateExpression(sched.kind, sched.expr).valid,
    firings: nextFirings(sched.kind, sched.expr, tz, new Date().toISOString(), count),
  })
})

// GET /triggers/:id/timeline — alias projecting a longer firing timeline
router.get('/triggers/:id/timeline', async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [rule] = await db.select().from(trigger_rules).where(eq(trigger_rules.id, id))
  if (!rule) return c.json({ error: 'Not found' }, 404)
  if (userId && rule.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const sched = extractSchedule(rule)
  if (!sched) return c.json({ schedule: null, timeline: [] })
  const tz = sched.timezone ?? 'UTC'
  return c.json({
    schedule: sched,
    description: describeExpression(sched.kind, sched.expr, tz),
    timeline: nextFirings(sched.kind, sched.expr, tz, new Date().toISOString(), 25),
  })
})

// GET /triggers/:id/dst — DST traps for one rule's schedule
router.get('/triggers/:id/dst', async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [rule] = await db.select().from(trigger_rules).where(eq(trigger_rules.id, id))
  if (!rule) return c.json({ error: 'Not found' }, 404)
  if (userId && rule.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const sched = extractSchedule(rule)
  if (!sched) return c.json({ schedule: null, traps: [] })
  const tz = sched.timezone ?? 'UTC'
  const days = Math.min(366, Math.max(1, parseInt(c.req.query('days') ?? '365', 10) || 365))
  return c.json({
    schedule: sched,
    traps: dstTraps(sched.kind, sched.expr, tz, new Date().toISOString(), days),
  })
})

// GET /schedule/collisions — minutes where multiple rules fire together
router.get('/schedule/collisions', async (c) => {
  const userId = getUserId(c)
  if (!userId) return c.json({ collisions: [] })
  const jobs = await scheduledJobsForUser(userId)
  const horizonDays = Math.min(90, Math.max(1, parseInt(c.req.query('horizonDays') ?? '7', 10) || 7))
  const threshold = Math.max(2, parseInt(c.req.query('threshold') ?? '2', 10) || 2)
  return c.json({ collisions: computeCollisions(jobs, { horizonDays, threshold }) })
})

// GET /schedule/heatmap — firing load bucketed by hour
router.get('/schedule/heatmap', async (c) => {
  const userId = getUserId(c)
  if (!userId) return c.json({ heatmap: [] })
  const jobs = await scheduledJobsForUser(userId)
  const horizonDays = Math.min(90, Math.max(1, parseInt(c.req.query('horizonDays') ?? '7', 10) || 7))
  return c.json({ heatmap: loadHeatmap(jobs, { horizonDays }) })
})

// GET /schedule/coverage — coverage gaps across all rules
router.get('/schedule/coverage', async (c) => {
  const userId = getUserId(c)
  if (!userId) return c.json({ gaps: [] })
  const jobs = await scheduledJobsForUser(userId)
  const horizonDays = Math.min(90, Math.max(1, parseInt(c.req.query('horizonDays') ?? '7', 10) || 7))
  return c.json({ gaps: coverageGaps([], jobs, { horizonDays }) })
})

// GET /schedule/optimizer — auto-spread suggestions to de-collide rules
router.get('/schedule/optimizer', async (c) => {
  const userId = getUserId(c)
  if (!userId) return c.json({ suggestions: [] })
  const jobs = await scheduledJobsForUser(userId)
  const threshold = Math.max(2, parseInt(c.req.query('threshold') ?? '2', 10) || 2)
  return c.json({ suggestions: autoSpread(jobs, { threshold }) })
})

// GET /stream — SSE feed: streams the current user's unread notification count
// plus the newest notifications, polling the DB on an interval.
router.get('/stream', async (c) => {
  const userId = getUserId(c)
  return streamSSE(c, async (stream) => {
    if (!userId) {
      await stream.writeSSE({ event: 'error', data: JSON.stringify({ error: 'Unauthorized' }) })
      return
    }
    let lastSeen = ''
    let ticks = 0
    // Bounded loop so the connection terminates cleanly (clients reconnect).
    while (ticks < 600) {
      const rows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.user_id, userId))
        .orderBy(desc(notifications.created_at))
        .limit(20)
      const unread = rows.filter((r) => !r.is_read).length
      const newest = rows[0]?.id ?? ''
      if (newest !== lastSeen) {
        lastSeen = newest
        await stream.writeSSE({
          event: 'feed',
          data: JSON.stringify({ unread, notifications: rows }),
          id: String(ticks),
        })
      } else {
        await stream.writeSSE({ event: 'ping', data: JSON.stringify({ unread }), id: String(ticks) })
      }
      ticks += 1
      await stream.sleep(5000)
    }
  })
})

export default router
