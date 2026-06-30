import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  accounts,
  plays,
  whitespace_sizing,
  eligibility_cells,
} from '../db/schema.js'
import { getUserId } from '../lib/auth.js'

const router = new Hono()

const UNASSIGNED = 'Unassigned'
const WON_STAGES = new Set(['won'])
const OPEN_STAGES = new Set(['identified', 'qualified', 'proposed'])

interface BookAccumulator {
  csm: string
  account_ids: Set<string>
  accounts_with_plays: Set<string>
  accounts_with_open_whitespace: Set<string>
  open_arr_cents: number // sized whitespace open ARR across the book
  current_arr_cents: number
  plays_total: number
  plays_open: number
  plays_won: number
  pipeline_arr_cents: number // sum of open ARR on open plays
  converted_arr_cents: number // sum of open ARR on won plays
}

function emptyAcc(csm: string): BookAccumulator {
  return {
    csm,
    account_ids: new Set(),
    accounts_with_plays: new Set(),
    accounts_with_open_whitespace: new Set(),
    open_arr_cents: 0,
    current_arr_cents: 0,
    plays_total: 0,
    plays_open: 0,
    plays_won: 0,
    pipeline_arr_cents: 0,
    converted_arr_cents: 0,
  }
}

// Build per-CSM accumulators from the user's accounts, sized whitespace, and plays.
async function buildBooks(userId: string) {
  const acctRows = await db.select().from(accounts).where(eq(accounts.user_id, userId))
  const sizingRows = await db
    .select()
    .from(whitespace_sizing)
    .where(eq(whitespace_sizing.user_id, userId))
  const playRows = await db.select().from(plays).where(eq(plays.user_id, userId))
  const eligRows = await db
    .select()
    .from(eligibility_cells)
    .where(
      and(
        eq(eligibility_cells.user_id, userId),
        eq(eligibility_cells.state, 'eligible_not_owned'),
      ),
    )

  const books = new Map<string, BookAccumulator>()
  const csmOf = new Map<string, string>()
  for (const a of acctRows) {
    const csm = a.csm_owner ?? UNASSIGNED
    csmOf.set(a.id, csm)
    if (!books.has(csm)) books.set(csm, emptyAcc(csm))
    const b = books.get(csm)!
    b.account_ids.add(a.id)
    b.current_arr_cents += a.current_arr_cents
  }

  // Sized whitespace ARR rolled up to the owning account's CSM.
  for (const s of sizingRows) {
    const csm = csmOf.get(s.account_id)
    if (!csm) continue
    const b = books.get(csm)!
    b.open_arr_cents += s.open_arr_cents
    if (s.open_arr_cents > 0) b.accounts_with_open_whitespace.add(s.account_id)
  }

  // Plays rolled up to the account's CSM.
  for (const p of playRows) {
    const csm = csmOf.get(p.account_id)
    if (!csm) continue
    const b = books.get(csm)!
    b.plays_total += 1
    b.accounts_with_plays.add(p.account_id)
    if (OPEN_STAGES.has(p.stage)) {
      b.plays_open += 1
      b.pipeline_arr_cents += p.open_arr_cents
    } else if (WON_STAGES.has(p.stage)) {
      b.plays_won += 1
      b.converted_arr_cents += p.open_arr_cents
    }
  }

  // Eligible-not-owned cells with no play => coverage gap accounts.
  const eligByAccount = new Map<string, number>()
  for (const cell of eligRows) {
    eligByAccount.set(cell.account_id, (eligByAccount.get(cell.account_id) ?? 0) + 1)
  }

  return { books, eligByAccount }
}

// GET / — per-CSM rollup (open ARR, plays, penetration, coverage gaps)
router.get('/', async (c) => {
  const userId = getUserId(c)
  const { books, eligByAccount } = await buildBooks(userId)

  // Per-account sized whitespace ARR, used to value coverage gaps.
  const sizingRows = await db
    .select()
    .from(whitespace_sizing)
    .where(eq(whitespace_sizing.user_id, userId))
  const sizingByAccount = new Map<string, number>()
  for (const s of sizingRows) {
    sizingByAccount.set(s.account_id, (sizingByAccount.get(s.account_id) ?? 0) + s.open_arr_cents)
  }

  const rows = Array.from(books.values()).map((b) => {
    const accountCount = b.account_ids.size
    // Coverage gap: accounts with open whitespace (sized or eligible) but no play.
    let coverageGapAccounts = 0
    let coverageGapArr = 0
    for (const acctId of b.account_ids) {
      const hasWhitespace =
        b.accounts_with_open_whitespace.has(acctId) ||
        sizingByAccount.has(acctId) ||
        eligByAccount.has(acctId)
      const hasPlay = b.accounts_with_plays.has(acctId)
      if (hasWhitespace && !hasPlay) {
        coverageGapAccounts += 1
        coverageGapArr += sizingByAccount.get(acctId) ?? 0
      }
    }
    const coverageRatio = accountCount > 0 ? b.accounts_with_plays.size / accountCount : 0
    return {
      csm: b.csm,
      account_count: accountCount,
      current_arr_cents: b.current_arr_cents,
      open_arr_cents: b.open_arr_cents,
      plays_total: b.plays_total,
      plays_open: b.plays_open,
      plays_won: b.plays_won,
      pipeline_arr_cents: b.pipeline_arr_cents,
      converted_arr_cents: b.converted_arr_cents,
      accounts_with_plays: b.accounts_with_plays.size,
      accounts_with_open_whitespace: b.accounts_with_open_whitespace.size,
      coverage_ratio: Math.round(coverageRatio * 1000) / 10,
      coverage_gap_accounts: coverageGapAccounts,
      coverage_gap_arr_cents: coverageGapArr,
    }
  })

  rows.sort((a, b) => b.open_arr_cents - a.open_arr_cents)
  return c.json(rows)
})

// GET /leaderboard — book leaderboard by open + converted ARR
router.get('/leaderboard', async (c) => {
  const userId = getUserId(c)
  const { books } = await buildBooks(userId)

  const rows = Array.from(books.values()).map((b) => {
    const winnable = b.plays_won + b.plays_open
    const winRate = b.plays_total > 0 ? b.plays_won / b.plays_total : 0
    return {
      csm: b.csm,
      account_count: b.account_ids.size,
      open_arr_cents: b.open_arr_cents,
      converted_arr_cents: b.converted_arr_cents,
      pipeline_arr_cents: b.pipeline_arr_cents,
      plays_total: b.plays_total,
      plays_won: b.plays_won,
      plays_open: b.plays_open,
      win_rate: Math.round(winRate * 1000) / 10,
      // Score: realized conversions weighted heavier than open pipeline.
      score: b.converted_arr_cents * 2 + b.open_arr_cents,
      _winnable: winnable,
    }
  })

  rows.sort((a, b) => b.score - a.score)
  const leaderboard = rows.map((r, i) => {
    const { _winnable, ...rest } = r
    return { rank: i + 1, ...rest }
  })
  return c.json(leaderboard)
})

export default router
