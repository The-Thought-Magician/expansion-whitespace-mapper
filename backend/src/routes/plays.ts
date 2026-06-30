import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  plays,
  play_activities,
  whitespace_sizing,
  eligibility_cells,
  accounts,
  products,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const PLAY_STAGES = ['identified', 'qualified', 'proposed', 'won', 'lost'] as const

const playSchema = z.object({
  account_id: z.string().min(1),
  product_id: z.string().min(1),
  play_type: z.string().min(1).default('cross_sell'),
  open_arr_cents: z.number().int().nonnegative().default(0),
  stage: z.enum(PLAY_STAGES).optional().default('identified'),
  owner: z.string().optional().nullable(),
  due_date: z.string().datetime().optional().nullable(),
  notes: z.string().optional().default(''),
})

const playUpdateSchema = z.object({
  play_type: z.string().min(1).optional(),
  open_arr_cents: z.number().int().nonnegative().optional(),
  stage: z.enum(PLAY_STAGES).optional(),
  owner: z.string().optional().nullable(),
  due_date: z.string().datetime().optional().nullable(),
  notes: z.string().optional(),
})

const stageSchema = z.object({
  stage: z.enum(PLAY_STAGES),
  body: z.string().optional().default(''),
})

const activitySchema = z.object({
  activity_type: z.string().min(1).optional().default('note'),
  body: z.string().min(1),
})

const bulkSchema = z.object({
  account_ids: z.array(z.string()).optional(),
  product_ids: z.array(z.string()).optional(),
  segment: z.string().optional(),
  play_type: z.string().optional().default('cross_sell'),
  owner: z.string().optional().nullable(),
  min_open_arr_cents: z.number().int().nonnegative().optional(),
})

// GET / — list plays (filter: stage, owner, account_id)
router.get('/', async (c) => {
  const userId = getUserId(c)
  const stage = c.req.query('stage')
  const owner = c.req.query('owner')
  const accountId = c.req.query('account_id')

  const conds = [eq(plays.user_id, userId)]
  if (stage) conds.push(eq(plays.stage, stage))
  if (owner) conds.push(eq(plays.owner, owner))
  if (accountId) conds.push(eq(plays.account_id, accountId))

  const rows = await db
    .select()
    .from(plays)
    .where(and(...conds))
    .orderBy(desc(plays.created_at))
  return c.json(rows)
})

// GET /:id — play detail + activities
router.get('/:id', async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [play] = await db
    .select()
    .from(plays)
    .where(and(eq(plays.id, id), eq(plays.user_id, userId)))
  if (!play) return c.json({ error: 'Not found' }, 404)
  const activities = await db
    .select()
    .from(play_activities)
    .where(eq(play_activities.play_id, id))
    .orderBy(desc(play_activities.created_at))
  return c.json({ play, activities })
})

// POST / — create play
router.post('/', authMiddleware, zValidator('json', playSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, body.account_id), eq(accounts.user_id, userId)))
  if (!account) return c.json({ error: 'Account not found' }, 404)
  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, body.product_id), eq(products.user_id, userId)))
  if (!product) return c.json({ error: 'Product not found' }, 404)

  const [created] = await db
    .insert(plays)
    .values({
      user_id: userId,
      account_id: body.account_id,
      product_id: body.product_id,
      play_type: body.play_type,
      open_arr_cents: body.open_arr_cents,
      stage: body.stage,
      owner: body.owner ?? account.csm_owner ?? null,
      due_date: body.due_date ? new Date(body.due_date) : null,
      notes: body.notes ?? '',
      created_by: userId,
    })
    .returning()

  await db.insert(play_activities).values({
    user_id: userId,
    play_id: created.id,
    activity_type: 'created',
    to_stage: created.stage,
    body: 'Play created',
    created_by: userId,
  })

  return c.json(created, 201)
})

// PUT /:id — update play
router.put('/:id', authMiddleware, zValidator('json', playUpdateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(plays)
    .where(eq(plays.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')
  const patch: Record<string, unknown> = { updated_at: new Date() }
  if (body.play_type !== undefined) patch.play_type = body.play_type
  if (body.open_arr_cents !== undefined) patch.open_arr_cents = body.open_arr_cents
  if (body.owner !== undefined) patch.owner = body.owner
  if (body.notes !== undefined) patch.notes = body.notes
  if (body.due_date !== undefined) patch.due_date = body.due_date ? new Date(body.due_date) : null

  // Stage change via PUT also logs an activity.
  if (body.stage !== undefined && body.stage !== existing.stage) {
    patch.stage = body.stage
    await db.insert(play_activities).values({
      user_id: userId,
      play_id: id,
      activity_type: 'stage_change',
      from_stage: existing.stage,
      to_stage: body.stage,
      body: `Stage changed from ${existing.stage} to ${body.stage}`,
      created_by: userId,
    })
  }

  const [updated] = await db
    .update(plays)
    .set(patch)
    .where(eq(plays.id, id))
    .returning()
  return c.json(updated)
})

// POST /:id/stage — transition stage (logs activity)
router.post('/:id/stage', authMiddleware, zValidator('json', stageSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(plays)
    .where(eq(plays.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const { stage, body } = c.req.valid('json')
  const [updated] = await db
    .update(plays)
    .set({ stage, updated_at: new Date() })
    .where(eq(plays.id, id))
    .returning()

  await db.insert(play_activities).values({
    user_id: userId,
    play_id: id,
    activity_type: 'stage_change',
    from_stage: existing.stage,
    to_stage: stage,
    body: body || `Stage changed from ${existing.stage} to ${stage}`,
    created_by: userId,
  })

  return c.json(updated)
})

// POST /:id/activities — add note activity
router.post('/:id/activities', authMiddleware, zValidator('json', activitySchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(plays)
    .where(eq(plays.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const { activity_type, body } = c.req.valid('json')
  const [activity] = await db
    .insert(play_activities)
    .values({
      user_id: userId,
      play_id: id,
      activity_type: activity_type || 'note',
      body,
      created_by: userId,
    })
    .returning()

  await db.update(plays).set({ updated_at: new Date() }).where(eq(plays.id, id))
  return c.json(activity, 201)
})

// DELETE /:id — delete play (and its activities)
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(plays)
    .where(eq(plays.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  await db.delete(play_activities).where(eq(play_activities.play_id, id))
  await db.delete(plays).where(eq(plays.id, id))
  return c.json({ success: true })
})

// POST /bulk-from-whitespace — create plays from filtered whitespace cells
router.post('/bulk-from-whitespace', authMiddleware, zValidator('json', bulkSchema), async (c) => {
  const userId = getUserId(c)
  const filters = c.req.valid('json')

  // Eligible-not-owned cells are the whitespace; size them via whitespace_sizing.
  const cells = await db
    .select()
    .from(eligibility_cells)
    .where(
      and(
        eq(eligibility_cells.user_id, userId),
        eq(eligibility_cells.state, 'eligible_not_owned'),
      ),
    )

  const sizingRows = await db
    .select()
    .from(whitespace_sizing)
    .where(eq(whitespace_sizing.user_id, userId))
  const sizingMap = new Map<string, number>()
  for (const s of sizingRows) {
    sizingMap.set(`${s.account_id}:${s.product_id}`, s.open_arr_cents)
  }

  const acctRows = await db.select().from(accounts).where(eq(accounts.user_id, userId))
  const acctMap = new Map(acctRows.map((a) => [a.id, a]))

  // Avoid duplicate plays for the same account/product pair already in the queue.
  const existingPlays = await db.select().from(plays).where(eq(plays.user_id, userId))
  const existingPairs = new Set(existingPlays.map((p) => `${p.account_id}:${p.product_id}`))

  const accountIdSet = filters.account_ids ? new Set(filters.account_ids) : null
  const productIdSet = filters.product_ids ? new Set(filters.product_ids) : null

  const toCreate: Array<typeof plays.$inferInsert> = []
  for (const cell of cells) {
    const pairKey = `${cell.account_id}:${cell.product_id}`
    if (existingPairs.has(pairKey)) continue
    if (accountIdSet && !accountIdSet.has(cell.account_id)) continue
    if (productIdSet && !productIdSet.has(cell.product_id)) continue
    const account = acctMap.get(cell.account_id)
    if (filters.segment && account?.segment !== filters.segment) continue
    const openArr = sizingMap.get(pairKey) ?? 0
    if (filters.min_open_arr_cents !== undefined && openArr < filters.min_open_arr_cents) continue

    toCreate.push({
      user_id: userId,
      account_id: cell.account_id,
      product_id: cell.product_id,
      play_type: filters.play_type ?? 'cross_sell',
      open_arr_cents: openArr,
      stage: 'identified',
      owner: filters.owner ?? account?.csm_owner ?? null,
      notes: 'Created from whitespace',
      created_by: userId,
    })
    existingPairs.add(pairKey)
  }

  if (toCreate.length === 0) return c.json({ created: 0 })

  const inserted = await db.insert(plays).values(toCreate).returning()
  if (inserted.length > 0) {
    await db.insert(play_activities).values(
      inserted.map((p) => ({
        user_id: userId,
        play_id: p.id,
        activity_type: 'created',
        to_stage: p.stage,
        body: 'Play created from whitespace',
        created_by: userId,
      })),
    )
  }

  return c.json({ created: inserted.length })
})

export default router
