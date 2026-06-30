import { Hono } from 'hono'
import { db } from '../db/index.js'
import {
  accounts,
  products,
  ownership,
  eligibility_cells,
  whitespace_sizing,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'

const router = new Hono()

// ---------------------------------------------------------------------------
// GET / — public — owned-vs-eligible matrix (accounts x products + cell state)
//
// Returns the full grid for the requesting user: every account row, every
// product column, and a cell for every (account, product) pair. Cell state is
// derived deterministically from ownership (owned wins) then materialized
// eligibility_cells, falling back to 'not_eligible' when neither exists.
// Optional query filters narrow the account set (segment, csm_owner).
// ---------------------------------------------------------------------------
router.get('/', async (c) => {
  const userId = c.req.header('X-User-Id') ?? c.req.header('x-user-id') ?? ''
  if (!userId) return c.json({ accounts: [], products: [], cells: [] })

  const segment = c.req.query('segment')
  const csm = c.req.query('csm_owner')

  const acctConds = [eq(accounts.user_id, userId)]
  if (segment) acctConds.push(eq(accounts.segment, segment))
  if (csm) acctConds.push(eq(accounts.csm_owner, csm))

  const [acctRows, prodRows, ownRows, eligRows, sizeRows] = await Promise.all([
    db.select().from(accounts).where(and(...acctConds)).orderBy(accounts.name),
    db
      .select()
      .from(products)
      .where(and(eq(products.user_id, userId), eq(products.is_active, true)))
      .orderBy(products.name),
    db.select().from(ownership).where(eq(ownership.user_id, userId)),
    db.select().from(eligibility_cells).where(eq(eligibility_cells.user_id, userId)),
    db.select().from(whitespace_sizing).where(eq(whitespace_sizing.user_id, userId)),
  ])

  const ownedKey = (a: string, p: string) => `${a}:${p}`
  const ownedMap = new Map<string, (typeof ownRows)[number]>()
  for (const o of ownRows) ownedMap.set(ownedKey(o.account_id, o.product_id), o)

  const eligMap = new Map<string, (typeof eligRows)[number]>()
  for (const e of eligRows) eligMap.set(ownedKey(e.account_id, e.product_id), e)

  // Keep only the most recent sizing per (account, product).
  const sizeMap = new Map<string, (typeof sizeRows)[number]>()
  for (const s of sizeRows) {
    const k = ownedKey(s.account_id, s.product_id)
    const prev = sizeMap.get(k)
    if (!prev || new Date(s.computed_at).getTime() > new Date(prev.computed_at).getTime()) {
      sizeMap.set(k, s)
    }
  }

  const cells: Array<{
    account_id: string
    product_id: string
    state: string
    reason: string
    owned_arr_cents: number
    open_arr_cents: number
    matched_rule_id: string | null
  }> = []

  for (const a of acctRows) {
    for (const p of prodRows) {
      const k = ownedKey(a.id, p.id)
      const owned = ownedMap.get(k)
      const elig = eligMap.get(k)
      const sized = sizeMap.get(k)
      let state: string
      let reason: string
      let matched_rule_id: string | null = null
      if (owned) {
        state = 'owned'
        reason = 'Account already owns this product'
      } else if (elig) {
        state = elig.state
        reason = elig.reason ?? ''
        matched_rule_id = elig.matched_rule_id ?? null
      } else {
        state = 'not_eligible'
        reason = 'No eligibility rule matched'
      }
      cells.push({
        account_id: a.id,
        product_id: p.id,
        state,
        reason,
        owned_arr_cents: owned?.owned_arr_cents ?? 0,
        open_arr_cents: sized?.open_arr_cents ?? 0,
        matched_rule_id,
      })
    }
  }

  return c.json({ accounts: acctRows, products: prodRows, cells })
})

// ---------------------------------------------------------------------------
// GET /cell — public — single-cell explanation (query account_id, product_id)
//
// Returns the resolved state, the human-readable reason, and the sized
// whitespace (if any) for one (account, product) pair.
// ---------------------------------------------------------------------------
router.get('/cell', async (c) => {
  const userId = c.req.header('X-User-Id') ?? c.req.header('x-user-id') ?? ''
  const accountId = c.req.query('account_id')
  const productId = c.req.query('product_id')
  if (!accountId || !productId) {
    return c.json({ error: 'account_id and product_id are required' }, 400)
  }

  const [acct] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.user_id, userId)))
  if (!acct) return c.json({ error: 'Account not found' }, 404)

  const [prod] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, productId), eq(products.user_id, userId)))
  if (!prod) return c.json({ error: 'Product not found' }, 404)

  const [owned] = await db
    .select()
    .from(ownership)
    .where(
      and(
        eq(ownership.user_id, userId),
        eq(ownership.account_id, accountId),
        eq(ownership.product_id, productId),
      ),
    )

  const [elig] = await db
    .select()
    .from(eligibility_cells)
    .where(
      and(
        eq(eligibility_cells.user_id, userId),
        eq(eligibility_cells.account_id, accountId),
        eq(eligibility_cells.product_id, productId),
      ),
    )

  const [sized] = await db
    .select()
    .from(whitespace_sizing)
    .where(
      and(
        eq(whitespace_sizing.user_id, userId),
        eq(whitespace_sizing.account_id, accountId),
        eq(whitespace_sizing.product_id, productId),
      ),
    )
    .orderBy(desc(whitespace_sizing.computed_at))
    .limit(1)

  let state: string
  let reason: string
  if (owned) {
    state = 'owned'
    reason = 'Account already owns this product'
  } else if (elig) {
    state = elig.state
    reason = elig.reason ?? ''
  } else {
    state = 'not_eligible'
    reason = 'No eligibility rule matched'
  }

  return c.json({
    state,
    reason,
    account: acct,
    product: prod,
    owned: owned ?? null,
    matched_rule_id: elig?.matched_rule_id ?? null,
    sized: sized ?? null,
  })
})

export default router
