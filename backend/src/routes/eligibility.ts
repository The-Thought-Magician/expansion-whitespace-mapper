import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  eligibility_rules,
  eligibility_cells,
  accounts,
  products,
  ownership,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Condition evaluation
// ---------------------------------------------------------------------------

type Condition = {
  field: string
  op: string
  value: unknown
}

// Resolve a condition field against an account row (top-level column or an
// entry in the account's `attributes` jsonb bag).
function resolveField(account: typeof accounts.$inferSelect, field: string): unknown {
  const direct = (account as unknown as Record<string, unknown>)[field]
  if (direct !== undefined) return direct
  const attrs = (account.attributes ?? {}) as Record<string, unknown>
  return attrs[field]
}

function evalCondition(account: typeof accounts.$inferSelect, cond: Condition): boolean {
  const actual = resolveField(account, cond.field)
  const expected = cond.value
  switch (cond.op) {
    case 'eq':
    case '=':
      return actual === expected
    case 'neq':
    case '!=':
      return actual !== expected
    case 'gt':
      return Number(actual) > Number(expected)
    case 'gte':
      return Number(actual) >= Number(expected)
    case 'lt':
      return Number(actual) < Number(expected)
    case 'lte':
      return Number(actual) <= Number(expected)
    case 'in':
      return Array.isArray(expected) && expected.includes(actual)
    case 'not_in':
      return Array.isArray(expected) && !expected.includes(actual)
    case 'contains':
      return typeof actual === 'string' && typeof expected === 'string' && actual.includes(expected)
    case 'exists':
      return actual !== undefined && actual !== null && actual !== ''
    default:
      return false
  }
}

function accountMatchesRule(
  account: typeof accounts.$inferSelect,
  rule: typeof eligibility_rules.$inferSelect,
): boolean {
  const conds = (rule.conditions ?? []) as unknown as Condition[]
  if (!Array.isArray(conds) || conds.length === 0) return true // empty => matches all
  if (rule.mode === 'any_match') return conds.some((cn) => evalCondition(account, cn))
  // default 'all_match'
  return conds.every((cn) => evalCondition(account, cn))
}

// ---------------------------------------------------------------------------
// Rules CRUD
// ---------------------------------------------------------------------------

const ruleSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().default(''),
  conditions: z
    .array(z.object({ field: z.string(), op: z.string(), value: z.unknown() }))
    .optional()
    .default([]),
  target_product_id: z.string().nullable().optional(),
  action: z.enum(['eligible', 'ineligible']).optional().default('eligible'),
  mode: z.enum(['all_match', 'any_match']).optional().default('all_match'),
  priority: z.number().int().optional().default(0),
  is_active: z.boolean().optional().default(true),
})

// Public: list eligibility rules (ordered by priority desc)
router.get('/rules', async (c) => {
  const userId = c.req.header('X-User-Id') ?? c.req.header('x-user-id')
  const rows = userId
    ? await db
        .select()
        .from(eligibility_rules)
        .where(eq(eligibility_rules.user_id, userId))
        .orderBy(desc(eligibility_rules.priority))
    : await db.select().from(eligibility_rules).orderBy(desc(eligibility_rules.priority))
  return c.json(rows)
})

// Auth: create rule
router.post('/rules', authMiddleware, zValidator('json', ruleSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  if (body.target_product_id) {
    const [prod] = await db.select().from(products).where(eq(products.id, body.target_product_id))
    if (!prod) return c.json({ error: 'Target product not found' }, 404)
    if (prod.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  }

  const [row] = await db
    .insert(eligibility_rules)
    .values({
      user_id: userId,
      name: body.name,
      description: body.description ?? '',
      conditions: body.conditions as Array<Record<string, unknown>>,
      target_product_id: body.target_product_id ?? null,
      action: body.action ?? 'eligible',
      mode: body.mode ?? 'all_match',
      priority: body.priority ?? 0,
      is_active: body.is_active ?? true,
    })
    .returning()
  return c.json(row, 201)
})

// Auth: update rule
router.put('/rules/:id', authMiddleware, zValidator('json', ruleSchema.partial()), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(eligibility_rules).where(eq(eligibility_rules.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')
  if (body.target_product_id) {
    const [prod] = await db.select().from(products).where(eq(products.id, body.target_product_id))
    if (!prod) return c.json({ error: 'Target product not found' }, 404)
    if (prod.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  }

  const patch: Record<string, unknown> = { updated_at: new Date() }
  if (body.name !== undefined) patch.name = body.name
  if (body.description !== undefined) patch.description = body.description
  if (body.conditions !== undefined) patch.conditions = body.conditions
  if (body.target_product_id !== undefined) patch.target_product_id = body.target_product_id
  if (body.action !== undefined) patch.action = body.action
  if (body.mode !== undefined) patch.mode = body.mode
  if (body.priority !== undefined) patch.priority = body.priority
  if (body.is_active !== undefined) patch.is_active = body.is_active

  const [updated] = await db
    .update(eligibility_rules)
    .set(patch)
    .where(eq(eligibility_rules.id, id))
    .returning()
  return c.json(updated)
})

// Auth: delete rule
router.delete('/rules/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(eligibility_rules).where(eq(eligibility_rules.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(eligibility_rules).where(eq(eligibility_rules.id, id))
  return c.json({ success: true })
})

// ---------------------------------------------------------------------------
// Helpers shared by preview + apply
// ---------------------------------------------------------------------------

// Compute the (account_id, product_id) cells a single rule would mark, scoped
// to a user. A rule with a target product applies that product to every
// matching account that does not already own it.
async function computeRuleCells(
  userId: string,
  rule: typeof eligibility_rules.$inferSelect,
) {
  const acctList = await db.select().from(accounts).where(eq(accounts.user_id, userId))
  const owned = await db.select().from(ownership).where(eq(ownership.user_id, userId))
  const ownedKey = new Set(owned.map((o) => `${o.account_id}::${o.product_id}`))

  const targets: string[] = []
  if (rule.target_product_id) {
    targets.push(rule.target_product_id)
  } else {
    const prodList = await db.select().from(products).where(eq(products.user_id, userId))
    for (const p of prodList) targets.push(p.id)
  }

  const cells: Array<{
    account_id: string
    product_id: string
    state: string
    reason: string
    owned: boolean
  }> = []

  for (const acct of acctList) {
    if (!accountMatchesRule(acct, rule)) continue
    for (const productId of targets) {
      const isOwned = ownedKey.has(`${acct.id}::${productId}`)
      const state =
        rule.action === 'ineligible'
          ? 'ineligible'
          : isOwned
            ? 'owned'
            : 'eligible_not_owned'
      cells.push({
        account_id: acct.id,
        product_id: productId,
        state,
        reason: `Rule "${rule.name}" matched (${rule.mode})`,
        owned: isOwned,
      })
    }
  }
  return cells
}

// Auth: dry-run preview — cells the rule would change
router.post('/rules/:id/preview', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [rule] = await db.select().from(eligibility_rules).where(eq(eligibility_rules.id, id))
  if (!rule) return c.json({ error: 'Not found' }, 404)
  if (rule.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const cells = await computeRuleCells(userId, rule)
  return c.json({
    affected: cells.length,
    sample: cells.slice(0, 50),
  })
})

// ---------------------------------------------------------------------------
// Apply: materialize eligibility_cells from active rules + ownership
// ---------------------------------------------------------------------------

router.post('/apply', authMiddleware, async (c) => {
  const userId = getUserId(c)

  const rules = await db
    .select()
    .from(eligibility_rules)
    .where(and(eq(eligibility_rules.user_id, userId), eq(eligibility_rules.is_active, true)))
    .orderBy(desc(eligibility_rules.priority))

  const acctList = await db.select().from(accounts).where(eq(accounts.user_id, userId))
  const prodList = await db.select().from(products).where(eq(products.user_id, userId))
  const owned = await db.select().from(ownership).where(eq(ownership.user_id, userId))
  const ownedKey = new Set(owned.map((o) => `${o.account_id}::${o.product_id}`))

  // Highest-priority rule that touches a given (account, product) wins.
  const decided = new Map<
    string,
    { account_id: string; product_id: string; state: string; reason: string; matched_rule_id: string }
  >()

  for (const rule of rules) {
    const targets: string[] = rule.target_product_id
      ? [rule.target_product_id]
      : prodList.map((p) => p.id)
    for (const acct of acctList) {
      if (!accountMatchesRule(acct, rule)) continue
      for (const productId of targets) {
        const key = `${acct.id}::${productId}`
        if (decided.has(key)) continue // earlier (higher-priority) rule already won
        const isOwned = ownedKey.has(key)
        const state =
          rule.action === 'ineligible'
            ? 'ineligible'
            : isOwned
              ? 'owned'
              : 'eligible_not_owned'
        decided.set(key, {
          account_id: acct.id,
          product_id: productId,
          state,
          reason: `Rule "${rule.name}" matched (${rule.mode})`,
          matched_rule_id: rule.id,
        })
      }
    }
  }

  // Replace this user's materialized cells with the freshly computed set.
  await db.delete(eligibility_cells).where(eq(eligibility_cells.user_id, userId))

  let cellsWritten = 0
  for (const cell of decided.values()) {
    await db
      .insert(eligibility_cells)
      .values({
        user_id: userId,
        account_id: cell.account_id,
        product_id: cell.product_id,
        state: cell.state,
        reason: cell.reason,
        matched_rule_id: cell.matched_rule_id,
        computed_at: new Date(),
      })
      .onConflictDoUpdate({
        target: [eligibility_cells.account_id, eligibility_cells.product_id],
        set: {
          state: cell.state,
          reason: cell.reason,
          matched_rule_id: cell.matched_rule_id,
          computed_at: new Date(),
        },
      })
    cellsWritten++
  }

  return c.json({ cells_written: cellsWritten })
})

export default router
