import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  snapshots,
  whitespace_sizing,
  eligibility_cells,
  ownership,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const createSchema = z.object({
  label: z.string().min(1),
})

// ---------------------------------------------------------------------------
// GET / — list snapshots (public read)
// ---------------------------------------------------------------------------
router.get('/', async (c) => {
  const userId = getUserId(c)
  if (!userId) return c.json([])
  const rows = await db
    .select()
    .from(snapshots)
    .where(eq(snapshots.user_id, userId))
    .orderBy(desc(snapshots.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// GET /compare — diff two snapshots (query a, b) — must be before /:id-style
// routes (there are none, but keep explicit path ordering clean)
// ---------------------------------------------------------------------------
router.get('/compare', async (c) => {
  const userId = getUserId(c)
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)
  const a = c.req.query('a')
  const b = c.req.query('b')
  if (!a || !b) return c.json({ error: 'Both snapshot ids (a, b) are required' }, 400)

  const [snapA] = await db
    .select()
    .from(snapshots)
    .where(and(eq(snapshots.id, a), eq(snapshots.user_id, userId)))
  const [snapB] = await db
    .select()
    .from(snapshots)
    .where(and(eq(snapshots.id, b), eq(snapshots.user_id, userId)))
  if (!snapA || !snapB) return c.json({ error: 'Snapshot not found' }, 404)

  // Sizing rows captured under each snapshot, keyed by account+product cell.
  const sizingA = await db
    .select()
    .from(whitespace_sizing)
    .where(
      and(eq(whitespace_sizing.user_id, userId), eq(whitespace_sizing.snapshot_id, a)),
    )
  const sizingB = await db
    .select()
    .from(whitespace_sizing)
    .where(
      and(eq(whitespace_sizing.user_id, userId), eq(whitespace_sizing.snapshot_id, b)),
    )

  const key = (r: { account_id: string; product_id: string }) =>
    `${r.account_id}::${r.product_id}`
  const mapA = new Map(sizingA.map((r) => [key(r), r]))
  const mapB = new Map(sizingB.map((r) => [key(r), r]))

  // opened: cells open (whitespace) in B but not in A.
  // converted: cells that were open in A but no longer open in B (i.e. were sold).
  // churned: cells that lost owned ARR — approximated via owned-arr drop captured
  //          in the snapshot metrics, falling back to 0 when unavailable.
  let openedArr = 0
  let openedCount = 0
  let convertedArr = 0
  let convertedCount = 0

  for (const [k, rowB] of mapB) {
    if (!mapA.has(k)) {
      openedArr += rowB.open_arr_cents
      openedCount += 1
    }
  }
  for (const [k, rowA] of mapA) {
    if (!mapB.has(k)) {
      convertedArr += rowA.open_arr_cents
      convertedCount += 1
    }
  }

  const ownedA = snapA.total_owned_arr_cents
  const ownedB = snapB.total_owned_arr_cents
  const churnedArr = ownedA > ownedB ? ownedA - ownedB : 0

  // NRR movement: change in owned (recurring) ARR between the two points.
  const nrrMovement =
    ownedA > 0 ? Math.round(((ownedB - ownedA) / ownedA) * 10000) / 100 : 0

  return c.json({
    a: snapA,
    b: snapB,
    opened: { count: openedCount, open_arr_cents: openedArr },
    converted: { count: convertedCount, converted_arr_cents: convertedArr },
    churned: { churned_arr_cents: churnedArr },
    nrr_movement: nrrMovement,
    open_arr_delta_cents: snapB.total_open_arr_cents - snapA.total_open_arr_cents,
    owned_arr_delta_cents: ownedB - ownedA,
  })
})

// ---------------------------------------------------------------------------
// POST / — create snapshot of current grid + sizing (auth-gated)
// ---------------------------------------------------------------------------
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const { label } = c.req.valid('json')

  // Current sizing total = open ARR across all sized cells for this user.
  const sizingRows = await db
    .select()
    .from(whitespace_sizing)
    .where(eq(whitespace_sizing.user_id, userId))
  const totalOpen = sizingRows.reduce((s, r) => s + r.open_arr_cents, 0)

  // Current owned ARR across all ownership cells.
  const ownedRows = await db
    .select()
    .from(ownership)
    .where(eq(ownership.user_id, userId))
  const totalOwned = ownedRows.reduce((s, r) => s + r.owned_arr_cents, 0)

  // Grid composition metrics from eligibility cells.
  const cells = await db
    .select()
    .from(eligibility_cells)
    .where(eq(eligibility_cells.user_id, userId))
  const stateCounts: Record<string, number> = {}
  for (const cell of cells) {
    stateCounts[cell.state] = (stateCounts[cell.state] ?? 0) + 1
  }

  const metrics = {
    sized_cells: sizingRows.length,
    owned_cells: ownedRows.length,
    eligibility_cells: cells.length,
    state_counts: stateCounts,
    captured_at: new Date().toISOString(),
  }

  const [snap] = await db
    .insert(snapshots)
    .values({
      user_id: userId,
      label,
      total_open_arr_cents: totalOpen,
      total_owned_arr_cents: totalOwned,
      metrics,
    })
    .returning()

  // Stamp the current sizing rows with this snapshot id so a later compare can
  // diff point-in-time cell sets. We copy (insert) rather than mutate so the
  // live sizing rows remain snapshot_id-null for the working set.
  if (sizingRows.length > 0) {
    await db.insert(whitespace_sizing).values(
      sizingRows.map((r) => ({
        user_id: userId,
        account_id: r.account_id,
        product_id: r.product_id,
        open_arr_cents: r.open_arr_cents,
        method: r.method,
        confidence: r.confidence,
        low_arr_cents: r.low_arr_cents,
        high_arr_cents: r.high_arr_cents,
        snapshot_id: snap.id,
      })),
    )
  }

  return c.json(snap, 201)
})

// ---------------------------------------------------------------------------
// DELETE /:id — delete snapshot (auth-gated, ownership-checked)
// ---------------------------------------------------------------------------
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(snapshots).where(eq(snapshots.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  // Remove the point-in-time sizing rows captured under this snapshot too.
  await db
    .delete(whitespace_sizing)
    .where(
      and(
        eq(whitespace_sizing.user_id, userId),
        eq(whitespace_sizing.snapshot_id, id),
      ),
    )
  await db.delete(snapshots).where(eq(snapshots.id, id))
  return c.json({ success: true })
})

export default router
