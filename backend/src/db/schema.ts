import { pgTable, text, integer, boolean, timestamp, jsonb, unique, real } from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------
export const accounts = pgTable('accounts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  external_id: text('external_id'),
  name: text('name').notNull(),
  segment: text('segment'),
  industry: text('industry'),
  region: text('region'),
  employee_band: text('employee_band'),
  plan_tier: text('plan_tier'),
  csm_owner: text('csm_owner'),
  current_arr_cents: integer('current_arr_cents').default(0).notNull(),
  attributes: jsonb('attributes').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [unique().on(t.user_id, t.external_id)])

// ---------------------------------------------------------------------------
// Products (catalog)
// ---------------------------------------------------------------------------
export const products = pgTable('products', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  sku_code: text('sku_code').notNull(),
  name: text('name').notNull(),
  description: text('description').default(''),
  category: text('category'),
  family: text('family'),
  product_type: text('product_type').default('flat_fee').notNull(),
  parent_product_id: text('parent_product_id'),
  is_active: boolean('is_active').default(true).notNull(),
  default_expansion_arr_cents: integer('default_expansion_arr_cents').default(0).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [unique().on(t.user_id, t.sku_code)])

// ---------------------------------------------------------------------------
// Price book
// ---------------------------------------------------------------------------
export const price_book = pgTable('price_book', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  product_id: text('product_id').notNull().references(() => products.id),
  segment: text('segment'),
  currency: text('currency').default('USD').notNull(),
  term: text('term').default('annual').notNull(),
  list_price_cents: integer('list_price_cents').default(0).notNull(),
  per_seat_cents: integer('per_seat_cents').default(0).notNull(),
  seat_band_min: integer('seat_band_min').default(1).notNull(),
  seat_band_max: integer('seat_band_max'),
  effective_from: timestamp('effective_from').defaultNow().notNull(),
  is_active: boolean('is_active').default(true).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Ownership (account x product owned cells)
// ---------------------------------------------------------------------------
export const ownership = pgTable('ownership', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  account_id: text('account_id').notNull().references(() => accounts.id),
  product_id: text('product_id').notNull().references(() => products.id),
  quantity: integer('quantity').default(1).notNull(),
  owned_arr_cents: integer('owned_arr_cents').default(0).notNull(),
  owned_since: timestamp('owned_since').defaultNow().notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.account_id, t.product_id)])

// ---------------------------------------------------------------------------
// Seat usage
// ---------------------------------------------------------------------------
export const seat_usage = pgTable('seat_usage', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  account_id: text('account_id').notNull().references(() => accounts.id),
  product_id: text('product_id').notNull().references(() => products.id),
  licensed_seats: integer('licensed_seats').default(0).notNull(),
  active_seats: integer('active_seats').default(0).notNull(),
  assigned_seats: integer('assigned_seats').default(0).notNull(),
  as_of: timestamp('as_of').defaultNow().notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.account_id, t.product_id)])

// ---------------------------------------------------------------------------
// Eligibility rules
// ---------------------------------------------------------------------------
export const eligibility_rules = pgTable('eligibility_rules', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  name: text('name').notNull(),
  description: text('description').default(''),
  conditions: jsonb('conditions').$type<Array<Record<string, unknown>>>().default([]),
  target_product_id: text('target_product_id').references(() => products.id),
  action: text('action').default('eligible').notNull(),
  mode: text('mode').default('all_match').notNull(),
  priority: integer('priority').default(0).notNull(),
  is_active: boolean('is_active').default(true).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Eligibility cells (materialized grid)
// ---------------------------------------------------------------------------
export const eligibility_cells = pgTable('eligibility_cells', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  account_id: text('account_id').notNull().references(() => accounts.id),
  product_id: text('product_id').notNull().references(() => products.id),
  state: text('state').default('eligible_not_owned').notNull(),
  reason: text('reason').default(''),
  matched_rule_id: text('matched_rule_id'),
  computed_at: timestamp('computed_at').defaultNow().notNull(),
}, (t) => [unique().on(t.account_id, t.product_id)])

// ---------------------------------------------------------------------------
// Whitespace sizing
// ---------------------------------------------------------------------------
export const whitespace_sizing = pgTable('whitespace_sizing', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  account_id: text('account_id').notNull().references(() => accounts.id),
  product_id: text('product_id').notNull().references(() => products.id),
  open_arr_cents: integer('open_arr_cents').default(0).notNull(),
  method: text('method').default('list_price').notNull(),
  confidence: text('confidence').default('expected').notNull(),
  low_arr_cents: integer('low_arr_cents').default(0).notNull(),
  high_arr_cents: integer('high_arr_cents').default(0).notNull(),
  snapshot_id: text('snapshot_id'),
  computed_at: timestamp('computed_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Look-alike suggestions
// ---------------------------------------------------------------------------
export const lookalike_suggestions = pgTable('lookalike_suggestions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  account_id: text('account_id').notNull().references(() => accounts.id),
  product_id: text('product_id').notNull().references(() => products.id),
  segment: text('segment'),
  adoption_rate: real('adoption_rate').default(0).notNull(),
  peer_count: integer('peer_count').default(0).notNull(),
  open_arr_cents: integer('open_arr_cents').default(0).notNull(),
  score: real('score').default(0).notNull(),
  explanation: text('explanation').default(''),
  computed_at: timestamp('computed_at').defaultNow().notNull(),
}, (t) => [unique().on(t.account_id, t.product_id)])

// ---------------------------------------------------------------------------
// Plays
// ---------------------------------------------------------------------------
export const plays = pgTable('plays', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  account_id: text('account_id').notNull().references(() => accounts.id),
  product_id: text('product_id').notNull().references(() => products.id),
  play_type: text('play_type').default('cross_sell').notNull(),
  open_arr_cents: integer('open_arr_cents').default(0).notNull(),
  stage: text('stage').default('identified').notNull(),
  owner: text('owner'),
  due_date: timestamp('due_date'),
  notes: text('notes').default(''),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Play activities
// ---------------------------------------------------------------------------
export const play_activities = pgTable('play_activities', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  play_id: text('play_id').notNull().references(() => plays.id),
  activity_type: text('activity_type').default('note').notNull(),
  from_stage: text('from_stage'),
  to_stage: text('to_stage'),
  body: text('body').default(''),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------
export const segments = pgTable('segments', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  name: text('name').notNull(),
  description: text('description').default(''),
  rules: jsonb('rules').$type<Array<Record<string, unknown>>>().default([]),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [unique().on(t.user_id, t.name)])

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------
export const snapshots = pgTable('snapshots', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  label: text('label').notNull(),
  total_open_arr_cents: integer('total_open_arr_cents').default(0).notNull(),
  total_owned_arr_cents: integer('total_owned_arr_cents').default(0).notNull(),
  metrics: jsonb('metrics').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------
export const targets = pgTable('targets', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  scope_type: text('scope_type').default('csm').notNull(),
  scope_value: text('scope_value').notNull(),
  period: text('period').notNull(),
  target_arr_cents: integer('target_arr_cents').default(0).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [unique().on(t.user_id, t.scope_type, t.scope_value, t.period)])

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
export const notifications = pgTable('notifications', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  kind: text('kind').default('info').notNull(),
  title: text('title').notNull(),
  body: text('body').default(''),
  link: text('link'),
  is_read: boolean('is_read').default(false).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Trigger rules
// ---------------------------------------------------------------------------
export const trigger_rules = pgTable('trigger_rules', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  name: text('name').notNull(),
  event_type: text('event_type').notNull(),
  conditions: jsonb('conditions').$type<Record<string, unknown>>().default({}),
  is_active: boolean('is_active').default(true).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Saved views
// ---------------------------------------------------------------------------
export const saved_views = pgTable('saved_views', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  name: text('name').notNull(),
  surface: text('surface').default('grid').notNull(),
  filters: jsonb('filters').$type<Record<string, unknown>>().default({}),
  is_shared: boolean('is_shared').default(false).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.user_id, t.name)])

// ---------------------------------------------------------------------------
// Import jobs
// ---------------------------------------------------------------------------
export const import_jobs = pgTable('import_jobs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  entity: text('entity').notNull(),
  status: text('status').default('completed').notNull(),
  row_count: integer('row_count').default(0).notNull(),
  error_count: integer('error_count').default(0).notNull(),
  errors: jsonb('errors').$type<Array<Record<string, unknown>>>().default([]),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------
export const audit_log = pgTable('audit_log', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  entity: text('entity').notNull(),
  entity_id: text('entity_id'),
  action: text('action').notNull(),
  detail: jsonb('detail').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// QBR exports
// ---------------------------------------------------------------------------
export const qbr_exports = pgTable('qbr_exports', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  account_id: text('account_id').notNull().references(() => accounts.id),
  payload: jsonb('payload').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Org settings
// ---------------------------------------------------------------------------
export const org_settings = pgTable('org_settings', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull().unique(),
  default_currency: text('default_currency').default('USD').notNull(),
  default_sizing_method: text('default_sizing_method').default('list_price').notNull(),
  default_term: text('default_term').default('annual').notNull(),
  settings: jsonb('settings').$type<Record<string, unknown>>().default({}),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})

// ---------------------------------------------------------------------------
// Billing: plans + subscriptions (matches webhook-inspector billing.ts)
// ---------------------------------------------------------------------------
export const plans = pgTable('plans', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  price_cents: integer('price_cents').notNull(),
})

export const subscriptions = pgTable('subscriptions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull().unique(),
  plan_id: text('plan_id').notNull().references(() => plans.id),
  stripe_customer_id: text('stripe_customer_id'),
  stripe_subscription_id: text('stripe_subscription_id'),
  status: text('status').default('active').notNull(),
  current_period_end: timestamp('current_period_end'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})
