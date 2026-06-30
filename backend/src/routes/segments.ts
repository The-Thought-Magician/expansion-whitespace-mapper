import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { segments, accounts } from '../db/schema.js'
import { eq, and } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// A segment rule: { field, op, value }. Fields map to account columns (or an
// `attributes.<key>` path into the jsonb attributes bag). All rules in a
// segment are AND-combined (membership = matches every rule).
const ruleSchema = z.object({
  field: z.string().min(1),
  op: z.enum([
    'eq',
    'neq',
    'in',
    'not_in',
    'gt',
    'gte',
    'lt',
    'lte',
    'contains',
    'exists',
  ]),
  value: z.unknown().optional(),
})

const segmentSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().default(''),
  rules: z.array(ruleSchema).optional().default([]),
})

type Rule = z.infer<typeof ruleSchema>
type AccountRow = typeof accounts.$inferSelect

const ACCOUNT_FIELDS = new Set([
  'external_id',
  'name',
  'segment',
  'industry',
  'region',
  'employee_band',
  'plan_tier',
  'csm_owner',
  'current_arr_cents',
])

// Resolve a rule field to a value on an account row. Supports top-level columns
// and `attributes.<key>` paths into the jsonb attributes bag.
function resolveField(account: AccountRow, field: string): unknown {
  if (field.startsWith('attributes.')) {
    const key = field.slice('attributes.'.length)
    const attrs = (account.attributes ?? {}) as Record<string, unknown>
    return attrs[key]
  }
  if (ACCOUNT_FIELDS.has(field)) {
    return (account as unknown as Record<string, unknown>)[field]
  }
  // Unknown field: also probe attributes by bare key for convenience.
  const attrs = (account.attributes ?? {}) as Record<string, unknown>
  return attrs[field]
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v)
  return null
}

function matchesRule(account: AccountRow, rule: Rule): boolean {
  const actual = resolveField(account, rule.field)
  const expected = rule.value
  switch (rule.op) {
    case 'exists':
      return actual !== null && actual !== undefined && actual !== ''
    case 'eq':
      return String(actual ?? '') === String(expected ?? '')
    case 'neq':
      return String(actual ?? '') !== String(expected ?? '')
    case 'in':
      return Array.isArray(expected) && expected.map((x) => String(x)).includes(String(actual ?? ''))
    case 'not_in':
      return !(
        Array.isArray(expected) && expected.map((x) => String(x)).includes(String(actual ?? ''))
      )
    case 'contains':
      return String(actual ?? '')
        .toLowerCase()
        .includes(String(expected ?? '').toLowerCase())
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const a = toNumber(actual)
      const e = toNumber(expected)
      if (a === null || e === null) return false
      if (rule.op === 'gt') return a > e
      if (rule.op === 'gte') return a >= e
      if (rule.op === 'lt') return a < e
      return a <= e
    }
    default:
      return false
  }
}

function matchesAll(account: AccountRow, rules: Rule[]): boolean {
  if (rules.length === 0) return true
  return rules.every((r) => matchesRule(account, r))
}

// ---------------------------------------------------------------------------
// GET / — list segments (public read)
// ---------------------------------------------------------------------------
router.get('/', async (c) => {
  const userId = getUserId(c)
  if (!userId) return c.json([])
  const rows = await db
    .select()
    .from(segments)
    .where(eq(segments.user_id, userId))
    .orderBy(segments.name)
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// GET /:id/members — preview matching accounts (public read)
// ---------------------------------------------------------------------------
router.get('/:id/members', async (c) => {
  const userId = getUserId(c)
  if (!userId) return c.json([])
  const id = c.req.param('id')
  const [seg] = await db
    .select()
    .from(segments)
    .where(and(eq(segments.id, id), eq(segments.user_id, userId)))
  if (!seg) return c.json({ error: 'Not found' }, 404)

  const all = await db.select().from(accounts).where(eq(accounts.user_id, userId))
  const rules = (seg.rules ?? []) as Rule[]
  const members = all.filter((a) => matchesAll(a, rules))
  return c.json(members)
})

// ---------------------------------------------------------------------------
// POST / — create segment (auth-gated)
// ---------------------------------------------------------------------------
router.post('/', authMiddleware, zValidator('json', segmentSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [seg] = await db
    .insert(segments)
    .values({
      user_id: userId,
      name: body.name,
      description: body.description,
      rules: body.rules as Array<Record<string, unknown>>,
    })
    .returning()
  return c.json(seg, 201)
})

// ---------------------------------------------------------------------------
// PUT /:id — update segment (auth-gated, ownership-checked)
// ---------------------------------------------------------------------------
router.put('/:id', authMiddleware, zValidator('json', segmentSchema.partial()), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(segments).where(eq(segments.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')
  const patch: Record<string, unknown> = { updated_at: new Date() }
  if (body.name !== undefined) patch.name = body.name
  if (body.description !== undefined) patch.description = body.description
  if (body.rules !== undefined) patch.rules = body.rules as Array<Record<string, unknown>>

  const [updated] = await db
    .update(segments)
    .set(patch)
    .where(eq(segments.id, id))
    .returning()
  return c.json(updated)
})

// ---------------------------------------------------------------------------
// DELETE /:id — delete segment (auth-gated, ownership-checked)
// ---------------------------------------------------------------------------
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(segments).where(eq(segments.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(segments).where(eq(segments.id, id))
  return c.json({ success: true })
})

export default router
