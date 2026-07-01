import { Hono } from 'hono'
import { db } from '../db/index.js'
import {
  accounts,
  products,
  ownership,
  whitespace_sizing,
  plays,
  eligibility_cells,
  lookalike_suggestions,
  segments,
  snapshots,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'

const router = new Hono()

// GET / — dashboard summary: total open ARR, top plays, book summary, entity counts.
router.get('/', async (c) => {
  const userId = c.req.header('X-User-Id') ?? c.req.header('x-user-id')
  if (!userId) {
    // Public/unauthenticated: return an empty, well-shaped summary.
    return c.json({
      totals: {
        total_open_arr_cents: 0,
        total_owned_arr_cents: 0,
        total_current_arr_cents: 0,
        weighted_pipeline_arr_cents: 0,
        eligible_not_owned_cells: 0,
      },
      topPlays: [],
      books: [],
      counts: {
        accounts: 0,
        products: 0,
        plays: 0,
        open_plays: 0,
        whitespace_cells: 0,
        lookalikes: 0,
        segments: 0,
        snapshots: 0,
      },
    })
  }

  // ---- Whitespace sizing: latest row per (account, product) ----
  const sizingRows = await db
    .select({
      account_id: whitespace_sizing.account_id,
      product_id: whitespace_sizing.product_id,
      open_arr_cents: whitespace_sizing.open_arr_cents,
      computed_at: whitespace_sizing.computed_at,
    })
    .from(whitespace_sizing)
    .where(eq(whitespace_sizing.user_id, userId))
    .orderBy(desc(whitespace_sizing.computed_at))

  const latestSizing = new Map<string, { account_id: string; open_arr_cents: number }>()
  for (const r of sizingRows) {
    const key = `${r.account_id}::${r.product_id}`
    if (!latestSizing.has(key)) {
      latestSizing.set(key, { account_id: r.account_id, open_arr_cents: r.open_arr_cents ?? 0 })
    }
  }
  let total_open_arr_cents = 0
  const openByAccount = new Map<string, number>()
  for (const v of latestSizing.values()) {
    total_open_arr_cents += v.open_arr_cents
    openByAccount.set(v.account_id, (openByAccount.get(v.account_id) ?? 0) + v.open_arr_cents)
  }

  // ---- Owned ARR ----
  const ownedRows = await db
    .select({ account_id: ownership.account_id, owned_arr_cents: ownership.owned_arr_cents })
    .from(ownership)
    .where(eq(ownership.user_id, userId))
  let total_owned_arr_cents = 0
  for (const r of ownedRows) total_owned_arr_cents += r.owned_arr_cents ?? 0

  // ---- Accounts (for CSM book rollups + current ARR) ----
  const accountRows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      csm_owner: accounts.csm_owner,
      current_arr_cents: accounts.current_arr_cents,
    })
    .from(accounts)
    .where(eq(accounts.user_id, userId))
  let total_current_arr_cents = 0
  for (const a of accountRows) total_current_arr_cents += a.current_arr_cents ?? 0

  // ---- Plays ----
  const playRows = await db
    .select({
      id: plays.id,
      account_id: plays.account_id,
      product_id: plays.product_id,
      play_type: plays.play_type,
      open_arr_cents: plays.open_arr_cents,
      stage: plays.stage,
      owner: plays.owner,
      due_date: plays.due_date,
    })
    .from(plays)
    .where(eq(plays.user_id, userId))

  // Stage weighting for a simple weighted-pipeline estimate.
  const STAGE_WEIGHTS: Record<string, number> = {
    identified: 0.1,
    qualified: 0.3,
    engaged: 0.5,
    proposed: 0.7,
    committed: 0.9,
    closed_won: 1,
    closed_lost: 0,
  }
  const OPEN_STAGES = new Set(['identified', 'qualified', 'engaged', 'proposed', 'committed'])

  let weighted_pipeline_arr_cents = 0
  let open_plays = 0
  const playsByOwner = new Map<string, { count: number; open_arr_cents: number }>()
  for (const p of playRows) {
    const w = STAGE_WEIGHTS[p.stage] ?? 0.1
    weighted_pipeline_arr_cents += Math.round((p.open_arr_cents ?? 0) * w)
    if (OPEN_STAGES.has(p.stage)) {
      open_plays += 1
      const owner = p.owner ?? 'Unassigned'
      const agg = playsByOwner.get(owner) ?? { count: 0, open_arr_cents: 0 }
      agg.count += 1
      agg.open_arr_cents += p.open_arr_cents ?? 0
      playsByOwner.set(owner, agg)
    }
  }

  // Account + product name maps for enriching top plays.
  const accountName = new Map(accountRows.map((a) => [a.id, a.name]))
  const productRows = await db
    .select({ id: products.id, name: products.name })
    .from(products)
    .where(eq(products.user_id, userId))
  const productName = new Map(productRows.map((p) => [p.id, p.name]))

  // ---- Top plays by open ARR (open stages only) ----
  const topPlays = playRows
    .filter((p) => OPEN_STAGES.has(p.stage))
    .sort((a, b) => (b.open_arr_cents ?? 0) - (a.open_arr_cents ?? 0))
    .slice(0, 10)
    .map((p) => ({
      id: p.id,
      account_id: p.account_id,
      account_name: accountName.get(p.account_id) ?? null,
      product_id: p.product_id,
      product_name: productName.get(p.product_id) ?? null,
      play_type: p.play_type,
      open_arr_cents: p.open_arr_cents,
      stage: p.stage,
      owner: p.owner,
      due_date: p.due_date,
    }))

  // ---- Book summary (per-CSM rollup) ----
  const bookMap = new Map<
    string,
    { csm: string; account_count: number; open_arr_cents: number; current_arr_cents: number }
  >()
  for (const a of accountRows) {
    const csm = a.csm_owner ?? 'Unassigned'
    const agg =
      bookMap.get(csm) ?? { csm, account_count: 0, open_arr_cents: 0, current_arr_cents: 0 }
    agg.account_count += 1
    agg.open_arr_cents += openByAccount.get(a.id) ?? 0
    agg.current_arr_cents += a.current_arr_cents ?? 0
    bookMap.set(csm, agg)
  }
  const books = Array.from(bookMap.values())
    .map((b) => ({
      ...b,
      csm_owner: b.csm,
      play_count: playsByOwner.get(b.csm)?.count ?? 0,
      play_open_arr_cents: playsByOwner.get(b.csm)?.open_arr_cents ?? 0,
    }))
    .sort((a, b) => b.open_arr_cents - a.open_arr_cents)

  // ---- Entity counts ----
  const eligibleNotOwned = await db
    .select({ id: eligibility_cells.id })
    .from(eligibility_cells)
    .where(
      and(
        eq(eligibility_cells.user_id, userId),
        eq(eligibility_cells.state, 'eligible_not_owned'),
      ),
    )

  const lookalikeRows = await db
    .select({ id: lookalike_suggestions.id })
    .from(lookalike_suggestions)
    .where(eq(lookalike_suggestions.user_id, userId))

  const segmentRows = await db
    .select({ id: segments.id })
    .from(segments)
    .where(eq(segments.user_id, userId))

  const snapshotRows = await db
    .select({ id: snapshots.id })
    .from(snapshots)
    .where(eq(snapshots.user_id, userId))

  return c.json({
    totals: {
      total_open_arr_cents,
      total_owned_arr_cents,
      total_current_arr_cents,
      weighted_pipeline_arr_cents,
      eligible_not_owned_cells: eligibleNotOwned.length,
    },
    topPlays,
    books,
    counts: {
      accounts: accountRows.length,
      products: productRows.length,
      plays: playRows.length,
      open_plays,
      whitespace_cells: latestSizing.size,
      lookalikes: lookalikeRows.length,
      segments: segmentRows.length,
      snapshots: snapshotRows.length,
    },
  })
})

export default router
