import { Hono } from 'hono'
import { db } from '../db/index.js'
import {
  qbr_exports,
  accounts,
  ownership,
  products,
  whitespace_sizing,
  eligibility_cells,
  seat_usage,
  plays,
  lookalike_suggestions,
  audit_log,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// GET / — list saved QBR exports (most recent first), optionally by account_id.
router.get('/', async (c) => {
  const accountId = c.req.query('account_id')
  const userIdHeader = c.req.header('X-User-Id') ?? c.req.header('x-user-id')

  const conds = []
  if (userIdHeader) conds.push(eq(qbr_exports.user_id, userIdHeader))
  if (accountId) conds.push(eq(qbr_exports.account_id, accountId))

  const rows = await db
    .select()
    .from(qbr_exports)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(qbr_exports.created_at))
  return c.json(rows)
})

// GET /:id — fetch a single saved QBR export payload.
router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [row] = await db.select().from(qbr_exports).where(eq(qbr_exports.id, id))
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

// POST /:accountId — generate + save a QBR one-pager payload for an account.
router.post('/:accountId', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const accountId = c.req.param('accountId')

  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.user_id, userId)))
  if (!account) return c.json({ error: 'Account not found' }, 404)

  // Owned products (join ownership -> products for names).
  const ownedRows = await db
    .select({
      ownership_id: ownership.id,
      product_id: ownership.product_id,
      quantity: ownership.quantity,
      owned_arr_cents: ownership.owned_arr_cents,
      owned_since: ownership.owned_since,
      sku_code: products.sku_code,
      product_name: products.name,
      family: products.family,
      category: products.category,
    })
    .from(ownership)
    .leftJoin(products, eq(ownership.product_id, products.id))
    .where(and(eq(ownership.account_id, accountId), eq(ownership.user_id, userId)))

  const owned_arr_cents = ownedRows.reduce((s, r) => s + (r.owned_arr_cents ?? 0), 0)

  // Whitespace sizing for this account (latest per product), joined to products.
  const sizingRows = await db
    .select({
      product_id: whitespace_sizing.product_id,
      open_arr_cents: whitespace_sizing.open_arr_cents,
      method: whitespace_sizing.method,
      confidence: whitespace_sizing.confidence,
      low_arr_cents: whitespace_sizing.low_arr_cents,
      high_arr_cents: whitespace_sizing.high_arr_cents,
      computed_at: whitespace_sizing.computed_at,
      product_name: products.name,
      sku_code: products.sku_code,
    })
    .from(whitespace_sizing)
    .leftJoin(products, eq(whitespace_sizing.product_id, products.id))
    .where(
      and(eq(whitespace_sizing.account_id, accountId), eq(whitespace_sizing.user_id, userId)),
    )
    .orderBy(desc(whitespace_sizing.computed_at))

  // Keep only the latest sizing row per product.
  const latestSizing = new Map<string, (typeof sizingRows)[number]>()
  for (const r of sizingRows) {
    if (!latestSizing.has(r.product_id)) latestSizing.set(r.product_id, r)
  }
  const whitespace = Array.from(latestSizing.values())
  const open_arr_cents = whitespace.reduce((s, r) => s + (r.open_arr_cents ?? 0), 0)

  // Eligibility cells (eligible-not-owned highlights).
  const cells = await db
    .select({
      product_id: eligibility_cells.product_id,
      state: eligibility_cells.state,
      reason: eligibility_cells.reason,
      product_name: products.name,
    })
    .from(eligibility_cells)
    .leftJoin(products, eq(eligibility_cells.product_id, products.id))
    .where(
      and(eq(eligibility_cells.account_id, accountId), eq(eligibility_cells.user_id, userId)),
    )

  // Seat penetration.
  const seatRows = await db
    .select({
      product_id: seat_usage.product_id,
      licensed_seats: seat_usage.licensed_seats,
      active_seats: seat_usage.active_seats,
      assigned_seats: seat_usage.assigned_seats,
      as_of: seat_usage.as_of,
      product_name: products.name,
    })
    .from(seat_usage)
    .leftJoin(products, eq(seat_usage.product_id, products.id))
    .where(and(eq(seat_usage.account_id, accountId), eq(seat_usage.user_id, userId)))

  const seats = seatRows.map((s) => ({
    ...s,
    penetration_pct:
      s.licensed_seats && s.licensed_seats > 0
        ? Math.round(((s.active_seats ?? 0) / s.licensed_seats) * 1000) / 10
        : 0,
  }))

  // Open / in-flight plays for the account.
  const accountPlays = await db
    .select({
      id: plays.id,
      product_id: plays.product_id,
      play_type: plays.play_type,
      open_arr_cents: plays.open_arr_cents,
      stage: plays.stage,
      owner: plays.owner,
      due_date: plays.due_date,
      product_name: products.name,
    })
    .from(plays)
    .leftJoin(products, eq(plays.product_id, products.id))
    .where(and(eq(plays.account_id, accountId), eq(plays.user_id, userId)))
    .orderBy(desc(plays.open_arr_cents))

  const plays_open_arr_cents = accountPlays.reduce((s, p) => s + (p.open_arr_cents ?? 0), 0)

  // Look-alike suggestions.
  const lookalikes = await db
    .select({
      product_id: lookalike_suggestions.product_id,
      adoption_rate: lookalike_suggestions.adoption_rate,
      peer_count: lookalike_suggestions.peer_count,
      open_arr_cents: lookalike_suggestions.open_arr_cents,
      score: lookalike_suggestions.score,
      explanation: lookalike_suggestions.explanation,
      product_name: products.name,
    })
    .from(lookalike_suggestions)
    .leftJoin(products, eq(lookalike_suggestions.product_id, products.id))
    .where(
      and(
        eq(lookalike_suggestions.account_id, accountId),
        eq(lookalike_suggestions.user_id, userId),
      ),
    )
    .orderBy(desc(lookalike_suggestions.score))

  const payload = {
    generated_at: new Date().toISOString(),
    account: {
      id: account.id,
      name: account.name,
      segment: account.segment,
      industry: account.industry,
      region: account.region,
      employee_band: account.employee_band,
      plan_tier: account.plan_tier,
      csm_owner: account.csm_owner,
      current_arr_cents: account.current_arr_cents,
    },
    summary: {
      current_arr_cents: account.current_arr_cents,
      owned_arr_cents,
      open_arr_cents,
      owned_product_count: ownedRows.length,
      whitespace_product_count: whitespace.length,
      open_play_count: accountPlays.length,
      plays_open_arr_cents,
      expansion_multiple:
        account.current_arr_cents && account.current_arr_cents > 0
          ? Math.round((open_arr_cents / account.current_arr_cents) * 100) / 100
          : 0,
    },
    owned: ownedRows,
    whitespace,
    eligibility: cells,
    seats,
    plays: accountPlays,
    lookalikes,
  }

  const [saved] = await db
    .insert(qbr_exports)
    .values({ user_id: userId, account_id: accountId, payload })
    .returning()

  await db.insert(audit_log).values({
    user_id: userId,
    entity: 'qbr_export',
    entity_id: saved.id,
    action: 'generate',
    detail: { account_id: accountId, open_arr_cents },
  })

  return c.json(saved, 201)
})

export default router
