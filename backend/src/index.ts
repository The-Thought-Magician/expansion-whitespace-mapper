import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { eq } from 'drizzle-orm'
import { db } from './db/index.js'
import { migrate } from './db/migrate.js'
import { plans, products, accounts } from './db/schema.js'

import accountsRoutes from './routes/accounts.js'
import productsRoutes from './routes/products.js'
import priceBookRoutes from './routes/price-book.js'
import ownershipRoutes from './routes/ownership.js'
import seatsRoutes from './routes/seats.js'
import eligibilityRoutes from './routes/eligibility.js'
import gridRoutes from './routes/grid.js'
import sizingRoutes from './routes/sizing.js'
import lookalikesRoutes from './routes/lookalikes.js'
import playsRoutes from './routes/plays.js'
import heatmapRoutes from './routes/heatmap.js'
import booksRoutes from './routes/books.js'
import snapshotsRoutes from './routes/snapshots.js'
import segmentsRoutes from './routes/segments.js'
import targetsRoutes from './routes/targets.js'
import analyticsRoutes from './routes/analytics.js'
import launchPlannerRoutes from './routes/launch-planner.js'
import notificationsRoutes from './routes/notifications.js'
import savedViewsRoutes from './routes/saved-views.js'
import importsRoutes from './routes/imports.js'
import auditRoutes from './routes/audit.js'
import qbrRoutes from './routes/qbr.js'
import settingsRoutes from './routes/settings.js'
import overviewRoutes from './routes/overview.js'
import seedRoutes from './routes/seed.js'
import billingRoutes from './routes/billing.js'

const app = new Hono()

const allowedOrigins = [
  process.env.FRONTEND_URL ?? 'http://localhost:3000',
  'https://expansion-whitespace-mapper.vercel.app',
]

app.use(
  '*',
  cors({
    origin: (origin) => (allowedOrigins.includes(origin) ? origin : allowedOrigins[0]),
    credentials: true,
  }),
)

const api = new Hono()
api.route('/accounts', accountsRoutes)
api.route('/products', productsRoutes)
api.route('/price-book', priceBookRoutes)
api.route('/ownership', ownershipRoutes)
api.route('/seats', seatsRoutes)
api.route('/eligibility', eligibilityRoutes)
api.route('/grid', gridRoutes)
api.route('/sizing', sizingRoutes)
api.route('/lookalikes', lookalikesRoutes)
api.route('/plays', playsRoutes)
api.route('/heatmap', heatmapRoutes)
api.route('/books', booksRoutes)
api.route('/snapshots', snapshotsRoutes)
api.route('/segments', segmentsRoutes)
api.route('/targets', targetsRoutes)
api.route('/analytics', analyticsRoutes)
api.route('/launch-planner', launchPlannerRoutes)
api.route('/notifications', notificationsRoutes)
api.route('/saved-views', savedViewsRoutes)
api.route('/imports', importsRoutes)
api.route('/audit', auditRoutes)
api.route('/qbr', qbrRoutes)
api.route('/settings', settingsRoutes)
api.route('/overview', overviewRoutes)
api.route('/seed', seedRoutes)
api.route('/billing', billingRoutes)

app.route('/api/v1', api)
app.get('/health', (c) => c.json({ ok: true }))

// ---------------------------------------------------------------------------
// Seeding — idempotent (count-then-insert). Seeds the two billing plans plus a
// tiny demo catalog so a fresh database renders something on first load. The
// full sample dataset is generated on demand via POST /api/v1/seed.
// ---------------------------------------------------------------------------
const DEMO_USER = 'demo'

const demoProducts = [
  { sku_code: 'CORE', name: 'Core Platform', family: 'Platform', category: 'core', product_type: 'flat_fee', default_expansion_arr_cents: 5000000 },
  { sku_code: 'ANALYTICS', name: 'Analytics Module', family: 'Add-on', category: 'analytics', product_type: 'flat_fee', default_expansion_arr_cents: 2000000 },
  { sku_code: 'SEATS', name: 'Collaboration Seats', family: 'Add-on', category: 'collaboration', product_type: 'per_seat', default_expansion_arr_cents: 1200000 },
]

const demoAccounts = [
  { external_id: 'ACME', name: 'Acme Corp', segment: 'Enterprise', industry: 'Manufacturing', region: 'NA', employee_band: '1001-5000', plan_tier: 'enterprise', csm_owner: 'Jordan Lee', current_arr_cents: 12000000 },
  { external_id: 'GLOBEX', name: 'Globex', segment: 'Mid-Market', industry: 'Technology', region: 'EU', employee_band: '201-1000', plan_tier: 'growth', csm_owner: 'Sam Rivera', current_arr_cents: 4500000 },
  { external_id: 'INITECH', name: 'Initech', segment: 'SMB', industry: 'Software', region: 'NA', employee_band: '51-200', plan_tier: 'starter', csm_owner: 'Jordan Lee', current_arr_cents: 900000 },
]

async function seedIfEmpty() {
  // Plans: required by billing.ts; seed 'free' + 'pro' if missing.
  const free = await db.query.plans.findFirst({ where: eq(plans.id, 'free') })
  if (!free) {
    await db.insert(plans).values({ id: 'free', name: 'Free', price_cents: 0 }).onConflictDoNothing()
  }
  const pro = await db.query.plans.findFirst({ where: eq(plans.id, 'pro') })
  if (!pro) {
    await db.insert(plans).values({ id: 'pro', name: 'Pro', price_cents: 9900 }).onConflictDoNothing()
  }

  // Demo catalog + accounts for the 'demo' workspace (only if none exist yet).
  const existingProducts = await db.select().from(products).where(eq(products.user_id, DEMO_USER)).limit(1)
  if (existingProducts.length === 0) {
    for (const p of demoProducts) {
      await db.insert(products).values({ ...p, user_id: DEMO_USER } as any).onConflictDoNothing()
    }
  }
  const existingAccounts = await db.select().from(accounts).where(eq(accounts.user_id, DEMO_USER)).limit(1)
  if (existingAccounts.length === 0) {
    for (const a of demoAccounts) {
      await db.insert(accounts).values({ ...a, user_id: DEMO_USER } as any).onConflictDoNothing()
    }
  }
}

const port = parseInt(process.env.PORT ?? '3001')

// CRITICAL boot order: bind the port FIRST so the platform health check sees a
// live service immediately, THEN run migrate() and seedIfEmpty() (both
// idempotent) so a slow/cold DB connection can never block port binding.
serve({ fetch: app.fetch, port }, () => console.log(`Server running on port ${port}`))

;(async () => {
  try {
    await migrate()
  } catch (e) {
    console.error('Migrate error:', e)
  }
  try {
    await seedIfEmpty()
  } catch (e) {
    console.error('Seed error:', e)
  }
})()

export default app
