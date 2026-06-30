import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { targets, plays, accounts } from '../db/schema.js'
import { eq, and } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// Plays in these stages count as converted (expansion ARR realized).
const CONVERTED_STAGES = new Set(['closed_won', 'won', 'converted'])

const targetSchema = z.object({
  scope_type: z.enum(['csm', 'segment', 'period', 'total']).optional().default('csm'),
  scope_value: z.string().min(1),
  period: z.string().min(1),
  target_arr_cents: z.number().int().nonnegative(),
})

type PlayRow = typeof plays.$inferSelect
type AccountRow = typeof accounts.$inferSelect

// Period match: a play counts toward a target's period when its updated_at (the
// time it last moved, i.e. when it converted) falls in the period bucket. We
// support YYYY, YYYY-MM and YYYY-Qn period labels, plus a literal date-prefix
// match for anything else.
function inPeriod(date: Date, period: string): boolean {
  const iso = date.toISOString()
  const p = period.trim()
  const quarter = /^(\d{4})-Q([1-4])$/.exec(p)
  if (quarter) {
    const year = quarter[1]
    const q = parseInt(quarter[2], 10)
    const startMonth = (q - 1) * 3 + 1
    const months = [startMonth, startMonth + 1, startMonth + 2].map((m) =>
      String(m).padStart(2, '0'),
    )
    return months.some((m) => iso.startsWith(`${year}-${m}`))
  }
  // YYYY or YYYY-MM (or any literal prefix) — prefix match on the ISO date.
  return iso.startsWith(p)
}

// Converted ARR attributable to a single target.
function convertedFor(
  target: typeof targets.$inferSelect,
  convertedPlays: PlayRow[],
  accountById: Map<string, AccountRow>,
): { converted_arr_cents: number; play_count: number } {
  let arr = 0
  let count = 0
  for (const play of convertedPlays) {
    if (!inPeriod(play.updated_at, target.period)) continue
    let scopeMatch = false
    if (target.scope_type === 'total') {
      scopeMatch = true
    } else if (target.scope_type === 'csm') {
      const acct = accountById.get(play.account_id)
      scopeMatch =
        play.owner === target.scope_value ||
        (acct?.csm_owner ?? null) === target.scope_value
    } else if (target.scope_type === 'segment') {
      const acct = accountById.get(play.account_id)
      scopeMatch = (acct?.segment ?? null) === target.scope_value
    } else if (target.scope_type === 'period') {
      // period-scoped targets aggregate everything in the period.
      scopeMatch = true
    }
    if (scopeMatch) {
      arr += play.open_arr_cents
      count += 1
    }
  }
  return { converted_arr_cents: arr, play_count: count }
}

// ---------------------------------------------------------------------------
// GET / — list targets with attainment vs converted ARR (public read)
// ---------------------------------------------------------------------------
router.get('/', async (c) => {
  const userId = getUserId(c)
  if (!userId) return c.json([])

  const rows = await db.select().from(targets).where(eq(targets.user_id, userId))
  const allPlays = await db.select().from(plays).where(eq(plays.user_id, userId))
  const convertedPlays = allPlays.filter((p) => CONVERTED_STAGES.has(p.stage))
  const acctRows = await db.select().from(accounts).where(eq(accounts.user_id, userId))
  const accountById = new Map(acctRows.map((a) => [a.id, a]))

  const out = rows.map((t) => {
    const { converted_arr_cents, play_count } = convertedFor(t, convertedPlays, accountById)
    const attainment_pct =
      t.target_arr_cents > 0
        ? Math.round((converted_arr_cents / t.target_arr_cents) * 10000) / 100
        : 0
    return {
      ...t,
      converted_arr_cents,
      converted_play_count: play_count,
      attainment_pct,
      remaining_arr_cents: Math.max(0, t.target_arr_cents - converted_arr_cents),
    }
  })
  return c.json(out)
})

// ---------------------------------------------------------------------------
// POST / — create / upsert target (auth-gated)
// ---------------------------------------------------------------------------
router.post('/', authMiddleware, zValidator('json', targetSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [t] = await db
    .insert(targets)
    .values({
      user_id: userId,
      scope_type: body.scope_type,
      scope_value: body.scope_value,
      period: body.period,
      target_arr_cents: body.target_arr_cents,
    })
    .onConflictDoUpdate({
      target: [targets.user_id, targets.scope_type, targets.scope_value, targets.period],
      set: { target_arr_cents: body.target_arr_cents, updated_at: new Date() },
    })
    .returning()
  return c.json(t, 201)
})

// ---------------------------------------------------------------------------
// PUT /:id — update target (auth-gated, ownership-checked)
// ---------------------------------------------------------------------------
router.put('/:id', authMiddleware, zValidator('json', targetSchema.partial()), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(targets).where(eq(targets.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')
  const patch: Record<string, unknown> = { updated_at: new Date() }
  if (body.scope_type !== undefined) patch.scope_type = body.scope_type
  if (body.scope_value !== undefined) patch.scope_value = body.scope_value
  if (body.period !== undefined) patch.period = body.period
  if (body.target_arr_cents !== undefined) patch.target_arr_cents = body.target_arr_cents

  const [updated] = await db
    .update(targets)
    .set(patch)
    .where(eq(targets.id, id))
    .returning()
  return c.json(updated)
})

// ---------------------------------------------------------------------------
// DELETE /:id — delete target (auth-gated, ownership-checked)
// ---------------------------------------------------------------------------
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(targets).where(eq(targets.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(targets).where(eq(targets.id, id))
  return c.json({ success: true })
})

export default router
