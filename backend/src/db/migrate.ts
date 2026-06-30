import { db } from './index.js'
import { sql } from 'drizzle-orm'

// Self-provisions the full schema on a fresh Neon database. Every statement is
// idempotent (IF NOT EXISTS) and the column names/types match schema.ts exactly.
const statements: string[] = [
  // accounts
  `CREATE TABLE IF NOT EXISTS accounts (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    external_id text,
    name text NOT NULL,
    segment text,
    industry text,
    region text,
    employee_band text,
    plan_tier text,
    csm_owner text,
    current_arr_cents integer NOT NULL DEFAULT 0,
    attributes jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, external_id)
  )`,

  // products
  `CREATE TABLE IF NOT EXISTS products (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    sku_code text NOT NULL,
    name text NOT NULL,
    description text DEFAULT '',
    category text,
    family text,
    product_type text NOT NULL DEFAULT 'flat_fee',
    parent_product_id text,
    is_active boolean NOT NULL DEFAULT true,
    default_expansion_arr_cents integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, sku_code)
  )`,

  // price_book
  `CREATE TABLE IF NOT EXISTS price_book (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    product_id text NOT NULL REFERENCES products(id),
    segment text,
    currency text NOT NULL DEFAULT 'USD',
    term text NOT NULL DEFAULT 'annual',
    list_price_cents integer NOT NULL DEFAULT 0,
    per_seat_cents integer NOT NULL DEFAULT 0,
    seat_band_min integer NOT NULL DEFAULT 1,
    seat_band_max integer,
    effective_from timestamptz NOT NULL DEFAULT now(),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // ownership
  `CREATE TABLE IF NOT EXISTS ownership (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    account_id text NOT NULL REFERENCES accounts(id),
    product_id text NOT NULL REFERENCES products(id),
    quantity integer NOT NULL DEFAULT 1,
    owned_arr_cents integer NOT NULL DEFAULT 0,
    owned_since timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (account_id, product_id)
  )`,

  // seat_usage
  `CREATE TABLE IF NOT EXISTS seat_usage (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    account_id text NOT NULL REFERENCES accounts(id),
    product_id text NOT NULL REFERENCES products(id),
    licensed_seats integer NOT NULL DEFAULT 0,
    active_seats integer NOT NULL DEFAULT 0,
    assigned_seats integer NOT NULL DEFAULT 0,
    as_of timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (account_id, product_id)
  )`,

  // eligibility_rules
  `CREATE TABLE IF NOT EXISTS eligibility_rules (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    name text NOT NULL,
    description text DEFAULT '',
    conditions jsonb DEFAULT '[]'::jsonb,
    target_product_id text REFERENCES products(id),
    action text NOT NULL DEFAULT 'eligible',
    mode text NOT NULL DEFAULT 'all_match',
    priority integer NOT NULL DEFAULT 0,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  // eligibility_cells
  `CREATE TABLE IF NOT EXISTS eligibility_cells (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    account_id text NOT NULL REFERENCES accounts(id),
    product_id text NOT NULL REFERENCES products(id),
    state text NOT NULL DEFAULT 'eligible_not_owned',
    reason text DEFAULT '',
    matched_rule_id text,
    computed_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (account_id, product_id)
  )`,

  // whitespace_sizing
  `CREATE TABLE IF NOT EXISTS whitespace_sizing (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    account_id text NOT NULL REFERENCES accounts(id),
    product_id text NOT NULL REFERENCES products(id),
    open_arr_cents integer NOT NULL DEFAULT 0,
    method text NOT NULL DEFAULT 'list_price',
    confidence text NOT NULL DEFAULT 'expected',
    low_arr_cents integer NOT NULL DEFAULT 0,
    high_arr_cents integer NOT NULL DEFAULT 0,
    snapshot_id text,
    computed_at timestamptz NOT NULL DEFAULT now()
  )`,

  // lookalike_suggestions
  `CREATE TABLE IF NOT EXISTS lookalike_suggestions (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    account_id text NOT NULL REFERENCES accounts(id),
    product_id text NOT NULL REFERENCES products(id),
    segment text,
    adoption_rate real NOT NULL DEFAULT 0,
    peer_count integer NOT NULL DEFAULT 0,
    open_arr_cents integer NOT NULL DEFAULT 0,
    score real NOT NULL DEFAULT 0,
    explanation text DEFAULT '',
    computed_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (account_id, product_id)
  )`,

  // plays
  `CREATE TABLE IF NOT EXISTS plays (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    account_id text NOT NULL REFERENCES accounts(id),
    product_id text NOT NULL REFERENCES products(id),
    play_type text NOT NULL DEFAULT 'cross_sell',
    open_arr_cents integer NOT NULL DEFAULT 0,
    stage text NOT NULL DEFAULT 'identified',
    owner text,
    due_date timestamptz,
    notes text DEFAULT '',
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  // play_activities
  `CREATE TABLE IF NOT EXISTS play_activities (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    play_id text NOT NULL REFERENCES plays(id),
    activity_type text NOT NULL DEFAULT 'note',
    from_stage text,
    to_stage text,
    body text DEFAULT '',
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // segments
  `CREATE TABLE IF NOT EXISTS segments (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    name text NOT NULL,
    description text DEFAULT '',
    rules jsonb DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, name)
  )`,

  // snapshots
  `CREATE TABLE IF NOT EXISTS snapshots (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    label text NOT NULL,
    total_open_arr_cents integer NOT NULL DEFAULT 0,
    total_owned_arr_cents integer NOT NULL DEFAULT 0,
    metrics jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // targets
  `CREATE TABLE IF NOT EXISTS targets (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    scope_type text NOT NULL DEFAULT 'csm',
    scope_value text NOT NULL,
    period text NOT NULL,
    target_arr_cents integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, scope_type, scope_value, period)
  )`,

  // notifications
  `CREATE TABLE IF NOT EXISTS notifications (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    kind text NOT NULL DEFAULT 'info',
    title text NOT NULL,
    body text DEFAULT '',
    link text,
    is_read boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // trigger_rules
  `CREATE TABLE IF NOT EXISTS trigger_rules (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    name text NOT NULL,
    event_type text NOT NULL,
    conditions jsonb DEFAULT '{}'::jsonb,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // saved_views
  `CREATE TABLE IF NOT EXISTS saved_views (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    name text NOT NULL,
    surface text NOT NULL DEFAULT 'grid',
    filters jsonb DEFAULT '{}'::jsonb,
    is_shared boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, name)
  )`,

  // import_jobs
  `CREATE TABLE IF NOT EXISTS import_jobs (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    entity text NOT NULL,
    status text NOT NULL DEFAULT 'completed',
    row_count integer NOT NULL DEFAULT 0,
    error_count integer NOT NULL DEFAULT 0,
    errors jsonb DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // audit_log
  `CREATE TABLE IF NOT EXISTS audit_log (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    entity text NOT NULL,
    entity_id text,
    action text NOT NULL,
    detail jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // qbr_exports
  `CREATE TABLE IF NOT EXISTS qbr_exports (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    account_id text NOT NULL REFERENCES accounts(id),
    payload jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // org_settings
  `CREATE TABLE IF NOT EXISTS org_settings (
    id text PRIMARY KEY,
    user_id text NOT NULL UNIQUE,
    default_currency text NOT NULL DEFAULT 'USD',
    default_sizing_method text NOT NULL DEFAULT 'list_price',
    default_term text NOT NULL DEFAULT 'annual',
    settings jsonb DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  // plans
  `CREATE TABLE IF NOT EXISTS plans (
    id text PRIMARY KEY,
    name text NOT NULL,
    price_cents integer NOT NULL
  )`,

  // subscriptions
  `CREATE TABLE IF NOT EXISTS subscriptions (
    id text PRIMARY KEY,
    user_id text NOT NULL UNIQUE,
    plan_id text NOT NULL REFERENCES plans(id),
    stripe_customer_id text,
    stripe_subscription_id text,
    status text NOT NULL DEFAULT 'active',
    current_period_end timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  // Indexes on FKs / user_id (workspace) hot paths
  `CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_accounts_segment ON accounts(segment)`,
  `CREATE INDEX IF NOT EXISTS idx_accounts_csm ON accounts(csm_owner)`,
  `CREATE INDEX IF NOT EXISTS idx_products_user ON products(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_products_parent ON products(parent_product_id)`,
  `CREATE INDEX IF NOT EXISTS idx_price_book_user ON price_book(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_price_book_product ON price_book(product_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ownership_user ON ownership(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ownership_account ON ownership(account_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ownership_product ON ownership(product_id)`,
  `CREATE INDEX IF NOT EXISTS idx_seat_usage_user ON seat_usage(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_seat_usage_account ON seat_usage(account_id)`,
  `CREATE INDEX IF NOT EXISTS idx_seat_usage_product ON seat_usage(product_id)`,
  `CREATE INDEX IF NOT EXISTS idx_elig_rules_user ON eligibility_rules(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_elig_rules_target ON eligibility_rules(target_product_id)`,
  `CREATE INDEX IF NOT EXISTS idx_elig_cells_user ON eligibility_cells(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_elig_cells_account ON eligibility_cells(account_id)`,
  `CREATE INDEX IF NOT EXISTS idx_elig_cells_product ON eligibility_cells(product_id)`,
  `CREATE INDEX IF NOT EXISTS idx_elig_cells_state ON eligibility_cells(state)`,
  `CREATE INDEX IF NOT EXISTS idx_sizing_user ON whitespace_sizing(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sizing_account ON whitespace_sizing(account_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sizing_snapshot ON whitespace_sizing(snapshot_id)`,
  `CREATE INDEX IF NOT EXISTS idx_lookalike_user ON lookalike_suggestions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_lookalike_account ON lookalike_suggestions(account_id)`,
  `CREATE INDEX IF NOT EXISTS idx_plays_user ON plays(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_plays_account ON plays(account_id)`,
  `CREATE INDEX IF NOT EXISTS idx_plays_stage ON plays(stage)`,
  `CREATE INDEX IF NOT EXISTS idx_plays_owner ON plays(owner)`,
  `CREATE INDEX IF NOT EXISTS idx_play_act_user ON play_activities(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_play_act_play ON play_activities(play_id)`,
  `CREATE INDEX IF NOT EXISTS idx_segments_user ON segments(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_snapshots_user ON snapshots(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_targets_user ON targets(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_trigger_rules_user ON trigger_rules(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_saved_views_user ON saved_views(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_import_jobs_user ON import_jobs(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_qbr_exports_user ON qbr_exports(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_qbr_exports_account ON qbr_exports(account_id)`,
  `CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_subscriptions_customer ON subscriptions(stripe_customer_id)`,
]

export async function migrate() {
  for (const stmt of statements) {
    await db.execute(sql.raw(stmt))
  }
  console.log(`Migrated ${statements.length} schema statements`)
}
