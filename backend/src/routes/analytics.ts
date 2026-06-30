import { Hono } from 'hono'
import { db } from '../db/index.js'
import { plays } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { getUserId } from '../lib/auth.js'

const router = new Hono()

// Stage -> probability weighting used to compute weighted (expected) pipeline ARR.
const STAGE_WEIGHTS: Record<string, number> = {
  identified: 0.1,
  qualified: 0.25,
  engaged: 0.4,
  proposed: 0.6,
  negotiating: 0.8,
  won: 1,
  lost: 0,
}

const OPEN_STAGES = new Set(['identified', 'qualified', 'engaged', 'proposed', 'negotiating'])
const TERMINAL_WON = 'won'
const TERMINAL_LOST = 'lost'

function bucketSum(
  rows: Array<{ key: string | null; open_arr_cents: number; stage: string }>,
) {
  const map = new Map<
    string,
    { key: string; count: number; open_arr_cents: number; weighted_arr_cents: number }
  >()
  for (const r of rows) {
    const key = r.key ?? 'unassigned'
    let e = map.get(key)
    if (!e) {
      e = { key, count: 0, open_arr_cents: 0, weighted_arr_cents: 0 }
      map.set(key, e)
    }
    e.count += 1
    e.open_arr_cents += r.open_arr_cents
    const w = STAGE_WEIGHTS[r.stage] ?? 0
    e.weighted_arr_cents += Math.round(r.open_arr_cents * w)
  }
  return Array.from(map.values()).sort((a, b) => b.open_arr_cents - a.open_arr_cents)
}

// GET /pipeline — plays by stage/owner/type, pipeline + weighted ARR
router.get('/pipeline', async (c) => {
  const userId = getUserId(c)
  const rows = userId
    ? await db.select().from(plays).where(eq(plays.user_id, userId))
    : []

  const byStage = bucketSum(rows.map((p) => ({ key: p.stage, open_arr_cents: p.open_arr_cents, stage: p.stage })))
  const byOwner = bucketSum(rows.map((p) => ({ key: p.owner, open_arr_cents: p.open_arr_cents, stage: p.stage })))
  const byType = bucketSum(rows.map((p) => ({ key: p.play_type, open_arr_cents: p.open_arr_cents, stage: p.stage })))

  let totalOpen = 0
  let weighted = 0
  let openCount = 0
  let wonArr = 0
  for (const p of rows) {
    if (OPEN_STAGES.has(p.stage)) {
      totalOpen += p.open_arr_cents
      weighted += Math.round(p.open_arr_cents * (STAGE_WEIGHTS[p.stage] ?? 0))
      openCount += 1
    } else if (p.stage === TERMINAL_WON) {
      wonArr += p.open_arr_cents
    }
  }

  return c.json({
    byStage,
    byOwner,
    byType,
    totals: {
      play_count: rows.length,
      open_count: openCount,
      open_arr_cents: totalOpen,
      weighted_arr_cents: weighted,
      won_arr_cents: wonArr,
    },
  })
})

// GET /conversion — win-rate, time-in-stage, aging plays
router.get('/conversion', async (c) => {
  const userId = getUserId(c)
  const rows = userId
    ? await db.select().from(plays).where(eq(plays.user_id, userId))
    : []

  let won = 0
  let lost = 0
  let openCount = 0
  for (const p of rows) {
    if (p.stage === TERMINAL_WON) won += 1
    else if (p.stage === TERMINAL_LOST) lost += 1
    else openCount += 1
  }
  const decided = won + lost
  const winRate = decided > 0 ? won / decided : 0

  // Time-in-current-stage: ms since the play last moved (updated_at), bucketed by stage.
  const now = Date.now()
  const stageAgg = new Map<string, { stage: string; count: number; total_days: number }>()
  const aging: Array<{
    id: string
    account_id: string
    product_id: string
    stage: string
    owner: string | null
    open_arr_cents: number
    age_days: number
  }> = []

  for (const p of rows) {
    if (!OPEN_STAGES.has(p.stage)) continue
    const updated = p.updated_at ? new Date(p.updated_at).getTime() : now
    const ageDays = Math.max(0, Math.floor((now - updated) / 86_400_000))
    let e = stageAgg.get(p.stage)
    if (!e) {
      e = { stage: p.stage, count: 0, total_days: 0 }
      stageAgg.set(p.stage, e)
    }
    e.count += 1
    e.total_days += ageDays
    if (ageDays >= 30) {
      aging.push({
        id: p.id,
        account_id: p.account_id,
        product_id: p.product_id,
        stage: p.stage,
        owner: p.owner ?? null,
        open_arr_cents: p.open_arr_cents,
        age_days: ageDays,
      })
    }
  }

  const timeInStage = Array.from(stageAgg.values())
    .map((e) => ({
      stage: e.stage,
      count: e.count,
      avg_age_days: e.count > 0 ? Math.round(e.total_days / e.count) : 0,
    }))
    .sort((a, b) => b.avg_age_days - a.avg_age_days)

  aging.sort((a, b) => b.age_days - a.age_days)

  return c.json({
    winRate,
    won_count: won,
    lost_count: lost,
    open_count: openCount,
    timeInStage,
    aging,
  })
})

export default router
