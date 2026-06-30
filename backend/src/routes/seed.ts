import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  accounts,
  products,
  price_book,
  ownership,
  seat_usage,
  eligibility_rules,
  eligibility_cells,
  whitespace_sizing,
  lookalike_suggestions,
  plays,
  play_activities,
  segments,
  snapshots,
  targets,
  notifications,
  trigger_rules,
  saved_views,
  import_jobs,
  audit_log,
  qbr_exports,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Deterministic sample-data generation
//
// Builds a realistic expansion-whitespace dataset scoped to one user:
//   - a product catalog (families + child modules + seat-based SKUs)
//   - a price book (list price + per-seat tiers per segment)
//   - ~40 accounts across segments / industries / regions / CSMs
//   - ownership cells (which accounts already own which products)
//   - seat-usage records (penetration + overage signal)
//   - eligibility rules (segment / industry / ownership gated)
//
// Everything is generated with a small seeded PRNG so repeated seeds against a
// fresh user produce a stable, demo-able dataset. All `*_cents` are integers.
// ---------------------------------------------------------------------------

// Tiny deterministic PRNG (mulberry32) so the dataset is reproducible.
function makeRng(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SEGMENTS = ['SMB', 'Mid-Market', 'Enterprise'] as const
const INDUSTRIES = [
  'SaaS',
  'Fintech',
  'Healthcare',
  'Retail',
  'Manufacturing',
  'Media',
  'Education',
  'Logistics',
]
const REGIONS = ['NA', 'EMEA', 'APAC', 'LATAM']
const EMPLOYEE_BANDS = ['1-50', '51-200', '201-1000', '1001-5000', '5000+']
const PLAN_TIERS = ['Starter', 'Growth', 'Scale', 'Enterprise']
const CSMS = ['Alex Rivera', 'Jordan Lee', 'Priya Patel', 'Sam Chen', 'Morgan Diaz']

// Catalog definition: parent families + child modules. product_type drives sizing.
interface SeedProduct {
  key: string
  sku_code: string
  name: string
  description: string
  category: string
  family: string
  product_type: 'flat_fee' | 'per_seat' | 'module'
  parentKey?: string
  default_expansion_arr_cents: number
}

const CATALOG: SeedProduct[] = [
  {
    key: 'core',
    sku_code: 'CORE-PLATFORM',
    name: 'Core Platform',
    description: 'Base platform subscription',
    category: 'Platform',
    family: 'Platform',
    product_type: 'flat_fee',
    default_expansion_arr_cents: 2_400_000,
  },
  {
    key: 'seats',
    sku_code: 'CORE-SEATS',
    name: 'Platform Seats',
    description: 'Per-seat user licenses',
    category: 'Platform',
    family: 'Platform',
    product_type: 'per_seat',
    parentKey: 'core',
    default_expansion_arr_cents: 0,
  },
  {
    key: 'analytics',
    sku_code: 'ADDON-ANALYTICS',
    name: 'Advanced Analytics',
    description: 'Dashboards, cohorts, and exports',
    category: 'Add-on',
    family: 'Analytics',
    product_type: 'flat_fee',
    default_expansion_arr_cents: 1_800_000,
  },
  {
    key: 'analytics-ml',
    sku_code: 'ADDON-ANALYTICS-ML',
    name: 'Predictive Insights',
    description: 'ML-driven forecasting module',
    category: 'Module',
    family: 'Analytics',
    product_type: 'module',
    parentKey: 'analytics',
    default_expansion_arr_cents: 1_200_000,
  },
  {
    key: 'security',
    sku_code: 'ADDON-SECURITY',
    name: 'Security & Compliance',
    description: 'SSO, audit logs, SCIM',
    category: 'Add-on',
    family: 'Security',
    product_type: 'flat_fee',
    default_expansion_arr_cents: 1_500_000,
  },
  {
    key: 'security-dlp',
    sku_code: 'ADDON-SECURITY-DLP',
    name: 'Data Loss Prevention',
    description: 'DLP policy engine module',
    category: 'Module',
    family: 'Security',
    product_type: 'module',
    parentKey: 'security',
    default_expansion_arr_cents: 900_000,
  },
  {
    key: 'integrations',
    sku_code: 'ADDON-INTEGRATIONS',
    name: 'Integrations Hub',
    description: 'Connector marketplace',
    category: 'Add-on',
    family: 'Integrations',
    product_type: 'flat_fee',
    default_expansion_arr_cents: 1_000_000,
  },
  {
    key: 'support',
    sku_code: 'ADDON-PREMIER-SUPPORT',
    name: 'Premier Support',
    description: '24/7 named TAM support',
    category: 'Service',
    family: 'Services',
    product_type: 'flat_fee',
    default_expansion_arr_cents: 1_600_000,
  },
  {
    key: 'sandbox',
    sku_code: 'ADDON-SANDBOX',
    name: 'Sandbox Environments',
    description: 'Isolated staging environments',
    category: 'Add-on',
    family: 'Platform',
    product_type: 'flat_fee',
    default_expansion_arr_cents: 800_000,
  },
]

// Eligibility rule templates (conditions are evaluated by the eligibility engine).
const RULE_TEMPLATES = [
  {
    name: 'Analytics for Mid-Market+',
    description: 'Offer Advanced Analytics to Mid-Market and Enterprise accounts.',
    productKey: 'analytics',
    conditions: [{ field: 'segment', op: 'in', value: ['Mid-Market', 'Enterprise'] }],
    action: 'eligible',
    mode: 'all_match',
    priority: 10,
  },
  {
    name: 'Predictive Insights requires Analytics',
    description: 'Predictive Insights only sells where Advanced Analytics is owned.',
    productKey: 'analytics-ml',
    conditions: [{ field: 'owns_product', op: 'eq', value: 'ADDON-ANALYTICS' }],
    action: 'eligible',
    mode: 'all_match',
    priority: 20,
  },
  {
    name: 'Security for regulated industries',
    description: 'Security & Compliance for Fintech and Healthcare.',
    productKey: 'security',
    conditions: [{ field: 'industry', op: 'in', value: ['Fintech', 'Healthcare'] }],
    action: 'eligible',
    mode: 'all_match',
    priority: 15,
  },
  {
    name: 'Enterprise Premier Support',
    description: 'Premier Support for Enterprise accounts.',
    productKey: 'support',
    conditions: [{ field: 'segment', op: 'eq', value: 'Enterprise' }],
    action: 'eligible',
    mode: 'all_match',
    priority: 12,
  },
  {
    name: 'Integrations broad availability',
    description: 'Integrations Hub is eligible for everyone.',
    productKey: 'integrations',
    conditions: [],
    action: 'eligible',
    mode: 'any_match',
    priority: 5,
  },
]

const SEGMENT_RULES = [
  {
    name: 'SMB',
    description: 'Small business accounts.',
    rules: [{ field: 'segment', op: 'eq', value: 'SMB' }],
  },
  {
    name: 'Mid-Market',
    description: 'Mid-market accounts.',
    rules: [{ field: 'segment', op: 'eq', value: 'Mid-Market' }],
  },
  {
    name: 'Enterprise',
    description: 'Enterprise accounts.',
    rules: [{ field: 'segment', op: 'eq', value: 'Enterprise' }],
  },
  {
    name: 'Regulated',
    description: 'Fintech and Healthcare accounts.',
    rules: [{ field: 'industry', op: 'in', value: ['Fintech', 'Healthcare'] }],
  },
]

const COMPANY_PREFIXES = [
  'Acme',
  'Globex',
  'Initech',
  'Umbrella',
  'Hooli',
  'Vandelay',
  'Soylent',
  'Stark',
  'Wayne',
  'Wonka',
  'Cyberdyne',
  'Tyrell',
  'Aperture',
  'Massive',
  'Pied Piper',
  'Dunder',
  'Prestige',
  'Sterling',
  'Gekko',
  'Oscorp',
]
const COMPANY_SUFFIXES = ['Labs', 'Systems', 'Group', 'Industries', 'Networks', 'Technologies', 'Holdings', 'Co']

// Wipe every table for one user (children before parents to respect FKs).
async function wipeUser(userId: string) {
  await db.delete(play_activities).where(eq(play_activities.user_id, userId))
  await db.delete(plays).where(eq(plays.user_id, userId))
  await db.delete(lookalike_suggestions).where(eq(lookalike_suggestions.user_id, userId))
  await db.delete(whitespace_sizing).where(eq(whitespace_sizing.user_id, userId))
  await db.delete(eligibility_cells).where(eq(eligibility_cells.user_id, userId))
  await db.delete(seat_usage).where(eq(seat_usage.user_id, userId))
  await db.delete(ownership).where(eq(ownership.user_id, userId))
  await db.delete(qbr_exports).where(eq(qbr_exports.user_id, userId))
  await db.delete(eligibility_rules).where(eq(eligibility_rules.user_id, userId))
  await db.delete(price_book).where(eq(price_book.user_id, userId))
  await db.delete(products).where(eq(products.user_id, userId))
  await db.delete(accounts).where(eq(accounts.user_id, userId))
  await db.delete(segments).where(eq(segments.user_id, userId))
  await db.delete(targets).where(eq(targets.user_id, userId))
  await db.delete(snapshots).where(eq(snapshots.user_id, userId))
  await db.delete(saved_views).where(eq(saved_views.user_id, userId))
  await db.delete(trigger_rules).where(eq(trigger_rules.user_id, userId))
  await db.delete(notifications).where(eq(notifications.user_id, userId))
  await db.delete(import_jobs).where(eq(import_jobs.user_id, userId))
  await db.delete(audit_log).where(eq(audit_log.user_id, userId))
}

interface SeedSummary {
  products: number
  price_entries: number
  accounts: number
  ownership: number
  seats: number
  rules: number
  segments: number
  targets: number
}

// Generate and persist the full dataset for one user.
async function generate(userId: string): Promise<SeedSummary> {
  const rng = makeRng(0x5eed)
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)]
  const range = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1))

  // --- Products --------------------------------------------------------------
  const productIdByKey = new Map<string, string>()
  // Two passes so a child's parent id is resolvable.
  for (const p of CATALOG) {
    const [row] = await db
      .insert(products)
      .values({
        user_id: userId,
        sku_code: p.sku_code,
        name: p.name,
        description: p.description,
        category: p.category,
        family: p.family,
        product_type: p.product_type,
        is_active: true,
        default_expansion_arr_cents: p.default_expansion_arr_cents,
      })
      .returning()
    productIdByKey.set(p.key, row.id)
  }
  // Wire parent links now that all ids exist.
  for (const p of CATALOG) {
    if (p.parentKey) {
      await db
        .update(products)
        .set({ parent_product_id: productIdByKey.get(p.parentKey) })
        .where(eq(products.id, productIdByKey.get(p.key)!))
    }
  }

  // --- Price book (one entry per product per segment) ------------------------
  let priceEntries = 0
  for (const p of CATALOG) {
    const base = p.default_expansion_arr_cents || 2_000_000
    for (const seg of SEGMENTS) {
      const segMult = seg === 'SMB' ? 0.6 : seg === 'Mid-Market' ? 1.0 : 1.8
      const list = Math.round(base * segMult)
      const perSeat = p.product_type === 'per_seat' ? Math.round(18_000 * segMult) : 0
      await db.insert(price_book).values({
        user_id: userId,
        product_id: productIdByKey.get(p.key)!,
        segment: seg,
        currency: 'USD',
        term: 'annual',
        list_price_cents: list,
        per_seat_cents: perSeat,
        seat_band_min: 1,
        seat_band_max: seg === 'Enterprise' ? null : seg === 'Mid-Market' ? 500 : 100,
        is_active: true,
      })
      priceEntries++
    }
  }

  // --- Accounts --------------------------------------------------------------
  const ACCOUNT_COUNT = 40
  const accountIds: string[] = []
  const accountSegment = new Map<string, string>()
  const accountIndustry = new Map<string, string>()
  for (let i = 0; i < ACCOUNT_COUNT; i++) {
    const segment = pick(SEGMENTS)
    const industry = pick(INDUSTRIES)
    const baseArr =
      segment === 'SMB'
        ? range(15_000, 60_000)
        : segment === 'Mid-Market'
          ? range(60_000, 250_000)
          : range(250_000, 1_200_000)
    const name = `${pick(COMPANY_PREFIXES)} ${pick(COMPANY_SUFFIXES)} ${i + 1}`
    const [row] = await db
      .insert(accounts)
      .values({
        user_id: userId,
        external_id: `ACC-${String(i + 1).padStart(4, '0')}`,
        name,
        segment,
        industry,
        region: pick(REGIONS),
        employee_band: pick(EMPLOYEE_BANDS),
        plan_tier: pick(PLAN_TIERS),
        csm_owner: pick(CSMS),
        current_arr_cents: baseArr * 100,
        attributes: { tier: segment, health: pick(['green', 'yellow', 'red']) },
      })
      .returning()
    accountIds.push(row.id)
    accountSegment.set(row.id, segment)
    accountIndustry.set(row.id, industry)
  }

  // --- Ownership + seat usage ------------------------------------------------
  // Every account owns Core Platform + Seats. Add-ons are owned probabilistically
  // so there is real whitespace (eligible-not-owned) to size and play against.
  let ownershipCount = 0
  let seatCount = 0
  const coreId = productIdByKey.get('core')!
  const seatsId = productIdByKey.get('seats')!

  for (const accId of accountIds) {
    const segment = accountSegment.get(accId)!
    const segMult = segment === 'SMB' ? 0.6 : segment === 'Mid-Market' ? 1.0 : 1.8

    // Core platform — always owned.
    await db.insert(ownership).values({
      user_id: userId,
      account_id: accId,
      product_id: coreId,
      quantity: 1,
      owned_arr_cents: Math.round(2_400_000 * segMult),
    })
    ownershipCount++

    // Seats — always owned, with usage that sometimes overshoots licensed count.
    const licensed = range(10, segment === 'Enterprise' ? 800 : segment === 'Mid-Market' ? 300 : 50)
    const overage = rng() < 0.3
    const active = overage ? licensed + range(1, Math.max(2, Math.round(licensed * 0.25))) : range(Math.floor(licensed * 0.4), licensed)
    const assigned = Math.min(licensed, Math.max(active, Math.round(licensed * 0.7)))
    await db.insert(ownership).values({
      user_id: userId,
      account_id: accId,
      product_id: seatsId,
      quantity: licensed,
      owned_arr_cents: licensed * Math.round(18_000 * segMult),
    })
    ownershipCount++
    await db.insert(seat_usage).values({
      user_id: userId,
      account_id: accId,
      product_id: seatsId,
      licensed_seats: licensed,
      active_seats: active,
      assigned_seats: assigned,
    })
    seatCount++

    // Add-ons owned with decreasing probability — leaves whitespace.
    const addonKeys = ['analytics', 'security', 'integrations', 'support', 'sandbox', 'analytics-ml', 'security-dlp']
    for (const key of addonKeys) {
      const def = CATALOG.find((p) => p.key === key)!
      // Modules only owned if their parent add-on is owned (checked below via prob skew).
      const ownProb = key.includes('-') ? 0.12 : 0.35
      if (rng() < ownProb) {
        await db.insert(ownership).values({
          user_id: userId,
          account_id: accId,
          product_id: productIdByKey.get(key)!,
          quantity: 1,
          owned_arr_cents: Math.round(def.default_expansion_arr_cents * segMult),
        })
        ownershipCount++
        // Seat-based usage rows for analytics (so seat page has more than core seats).
        if (key === 'analytics') {
          const lic = range(5, Math.max(6, Math.round(licensed * 0.6)))
          await db.insert(seat_usage).values({
            user_id: userId,
            account_id: accId,
            product_id: productIdByKey.get(key)!,
            licensed_seats: lic,
            active_seats: range(Math.floor(lic * 0.5), lic),
            assigned_seats: range(Math.floor(lic * 0.6), lic),
          })
          seatCount++
        }
      }
    }
  }

  // --- Eligibility rules -----------------------------------------------------
  let ruleCount = 0
  for (const t of RULE_TEMPLATES) {
    await db.insert(eligibility_rules).values({
      user_id: userId,
      name: t.name,
      description: t.description,
      conditions: t.conditions,
      target_product_id: productIdByKey.get(t.productKey)!,
      action: t.action,
      mode: t.mode,
      priority: t.priority,
      is_active: true,
    })
    ruleCount++
  }

  // --- Segments --------------------------------------------------------------
  let segmentCount = 0
  for (const s of SEGMENT_RULES) {
    await db.insert(segments).values({
      user_id: userId,
      name: s.name,
      description: s.description,
      rules: s.rules,
    })
    segmentCount++
  }

  // --- Targets (one quota per CSM for the current period) --------------------
  let targetCount = 0
  const period = '2026-H2'
  for (const csm of CSMS) {
    await db.insert(targets).values({
      user_id: userId,
      scope_type: 'csm',
      scope_value: csm,
      period,
      target_arr_cents: range(2_000_000, 8_000_000),
    })
    targetCount++
  }
  // A team-wide target too.
  await db.insert(targets).values({
    user_id: userId,
    scope_type: 'total',
    scope_value: 'all',
    period,
    target_arr_cents: range(20_000_000, 40_000_000),
  })
  targetCount++

  // --- A welcome notification + default saved view --------------------------
  await db.insert(notifications).values({
    user_id: userId,
    kind: 'info',
    title: 'Sample data loaded',
    body: 'A demo catalog, price book, 40 accounts, ownership, seats, and eligibility rules were created. Run Eligibility → Apply, then Sizing → Compute to populate the whitespace grid.',
    link: '/dashboard/grid',
    is_read: false,
  })
  await db.insert(saved_views).values({
    user_id: userId,
    name: 'Open whitespace (Enterprise)',
    surface: 'grid',
    filters: { segment: 'Enterprise', state: 'eligible_not_owned' },
    is_shared: false,
  })

  // Audit trail.
  await db.insert(audit_log).values({
    user_id: userId,
    entity: 'seed',
    entity_id: null,
    action: 'seed_sample_data',
    detail: { accounts: ACCOUNT_COUNT, products: CATALOG.length, rules: ruleCount },
  })

  return {
    products: CATALOG.length,
    price_entries: priceEntries,
    accounts: ACCOUNT_COUNT,
    ownership: ownershipCount,
    seats: seatCount,
    rules: ruleCount,
    segments: segmentCount,
    targets: targetCount,
  }
}

// ---------------------------------------------------------------------------
// POST / — generate sample dataset (only seeds if the user has no catalog yet)
// ---------------------------------------------------------------------------
router.post('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const existing = await db.select().from(products).where(eq(products.user_id, userId)).limit(1)
  if (existing.length > 0) {
    return c.json(
      { seeded: false, message: 'Sample data already present. Use /reset to wipe and reseed.' },
      200,
    )
  }
  const summary = await generate(userId)
  return c.json({ seeded: true, summary }, 201)
})

// ---------------------------------------------------------------------------
// POST /reset — wipe all of the current user's data, then reseed
// ---------------------------------------------------------------------------
router.post('/reset', authMiddleware, async (c) => {
  const userId = getUserId(c)
  await wipeUser(userId)
  const summary = await generate(userId)
  return c.json({ reset: true, summary }, 200)
})

export default router
