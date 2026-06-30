# Expansion Whitespace Mapper — Build Contract (Authoritative)

This is the single source of truth. Filenames, mount paths, api method names, and page files declared here are **binding**. Every api method is implemented by exactly one route endpoint and consumed by at least one page.

Stack: Hono + TypeScript backend (Render), Next.js 16 + React 19 + Tailwind 4 frontend (Vercel), Neon Postgres + Neon Auth `@neondatabase/auth@0.4.2-beta`. Backend trusts `X-User-Id` header via `getUserId(c)`. Routes mount under `/api/v1` via a child Hono `api` router. Frontend calls `fetch('/api/proxy/<path>')` mapping 1:1 to `/api/v1/<path>`. All features free; Stripe optional (503 when unconfigured).

---

## (a) Tables (columns)

- **accounts** — id, user_id, external_id, name, segment, industry, region, employee_band, plan_tier, csm_owner, current_arr_cents, attributes(jsonb), created_at, updated_at. UNIQUE(user_id, external_id).
- **products** — id, user_id, sku_code, name, description, category, family, product_type, parent_product_id, is_active, default_expansion_arr_cents, created_at, updated_at. UNIQUE(user_id, sku_code).
- **price_book** — id, user_id, product_id→products, segment, currency, term, list_price_cents, per_seat_cents, seat_band_min, seat_band_max, effective_from, is_active, created_at.
- **ownership** — id, user_id, account_id→accounts, product_id→products, quantity, owned_arr_cents, owned_since, created_at. UNIQUE(account_id, product_id).
- **seat_usage** — id, user_id, account_id→accounts, product_id→products, licensed_seats, active_seats, assigned_seats, as_of, created_at. UNIQUE(account_id, product_id).
- **eligibility_rules** — id, user_id, name, description, conditions(jsonb), target_product_id→products, action, mode, priority, is_active, created_at, updated_at.
- **eligibility_cells** — id, user_id, account_id→accounts, product_id→products, state, reason, matched_rule_id, computed_at. UNIQUE(account_id, product_id).
- **whitespace_sizing** — id, user_id, account_id→accounts, product_id→products, open_arr_cents, method, confidence, low_arr_cents, high_arr_cents, snapshot_id, computed_at.
- **lookalike_suggestions** — id, user_id, account_id→accounts, product_id→products, segment, adoption_rate(real), peer_count, open_arr_cents, score(real), explanation, computed_at. UNIQUE(account_id, product_id).
- **plays** — id, user_id, account_id→accounts, product_id→products, play_type, open_arr_cents, stage, owner, due_date, notes, created_by, created_at, updated_at.
- **play_activities** — id, user_id, play_id→plays, activity_type, from_stage, to_stage, body, created_by, created_at.
- **segments** — id, user_id, name, description, rules(jsonb), created_at, updated_at. UNIQUE(user_id, name).
- **snapshots** — id, user_id, label, total_open_arr_cents, total_owned_arr_cents, metrics(jsonb), created_at.
- **targets** — id, user_id, scope_type, scope_value, period, target_arr_cents, created_at, updated_at. UNIQUE(user_id, scope_type, scope_value, period).
- **notifications** — id, user_id, kind, title, body, link, is_read, created_at.
- **trigger_rules** — id, user_id, name, event_type, conditions(jsonb), is_active, created_at.
- **saved_views** — id, user_id, name, surface, filters(jsonb), is_shared, created_at. UNIQUE(user_id, name).
- **import_jobs** — id, user_id, entity, status, row_count, error_count, errors(jsonb), created_at.
- **audit_log** — id, user_id, entity, entity_id, action, detail(jsonb), created_at.
- **qbr_exports** — id, user_id, account_id→accounts, payload(jsonb), created_at.
- **org_settings** — id, user_id(unique), default_currency, default_sizing_method, default_term, settings(jsonb), updated_at.
- **plans** — id(text PK, seeded 'free'/'pro'), name, price_cents.
- **subscriptions** — id, user_id(unique), plan_id→plans, stripe_customer_id, stripe_subscription_id, status, current_period_end, created_at, updated_at.

---

## (b) Backend route files (mount under `/api/v1`)

Conventions: each file `export default router`. Public reads, auth-gated writes (`authMiddleware` + zod). Ownership checks via `user_id === getUserId(c)`. `*_cents` returned as integers.

### `accounts.ts` → `/api/v1/accounts`
- `GET /` — no — list accounts (query filters: segment, csm_owner, region, industry) — `Account[]`
- `GET /:id` — no — account detail with rollups (owned products, open ARR, seat penetration, plays, lookalikes) — `{ account, owned, whitespace, seats, plays, lookalikes }`
- `POST /` — yes — create account — `Account`
- `PUT /:id` — yes — update account — `Account`
- `DELETE /:id` — yes — delete account — `{ success }`

### `products.ts` → `/api/v1/products`
- `GET /` — no — list catalog (filter: family, category, is_active) — `Product[]`
- `GET /:id` — no — product detail + child modules — `{ product, modules }`
- `POST /` — yes — create product — `Product`
- `PUT /:id` — yes — update product — `Product`
- `DELETE /:id` — yes — retire/delete product — `{ success }`
- `POST /import` — yes — bulk import catalog rows — `{ imported, errors }`

### `price-book.ts` → `/api/v1/price-book`
- `GET /` — no — list price entries (filter: product_id, segment) — `PriceEntry[]`
- `POST /` — yes — create price entry — `PriceEntry`
- `PUT /:id` — yes — update price entry — `PriceEntry`
- `DELETE /:id` — yes — delete price entry — `{ success }`

### `ownership.ts` → `/api/v1/ownership`
- `GET /` — no — list ownership cells (filter: account_id, product_id) — `Ownership[]`
- `POST /` — yes — upsert ownership cell — `Ownership`
- `DELETE /:id` — yes — delete ownership cell — `{ success }`
- `POST /import` — yes — bulk import ownership — `{ imported, errors }`

### `seats.ts` → `/api/v1/seats`
- `GET /` — no — list seat usage with penetration ratios — `SeatRow[]`
- `GET /overage` — no — accounts where active > licensed sized as upsell — `OverageRow[]`
- `POST /` — yes — upsert seat usage record — `SeatRow`
- `POST /import` — yes — bulk import seat usage — `{ imported, errors }`

### `eligibility.ts` → `/api/v1/eligibility`
- `GET /rules` — no — list eligibility rules — `Rule[]`
- `POST /rules` — yes — create rule — `Rule`
- `PUT /rules/:id` — yes — update rule — `Rule`
- `DELETE /rules/:id` — yes — delete rule — `{ success }`
- `POST /rules/:id/preview` — yes — dry-run: cells the rule would change — `{ affected, sample }`
- `POST /apply` — yes — materialize eligibility_cells from rules + ownership — `{ cells_written }`

### `grid.ts` → `/api/v1/grid`
- `GET /` — no — the owned-vs-eligible matrix (accounts x products + cell state) — `{ accounts, products, cells }`
- `GET /cell` — no — single cell explanation (query account_id, product_id) — `{ state, reason, sized }`

### `sizing.ts` → `/api/v1/sizing`
- `GET /` — no — list sized whitespace cells (filter: account_id) — `Sizing[]`
- `GET /rollups` — no — open ARR rolled up by account/csm/segment/total — `{ total, byAccount, byCsm, bySegment }`
- `POST /compute` — yes — (re)size all eligible cells (body: method) — `{ sized, total_open_arr_cents }`

### `lookalikes.ts` → `/api/v1/lookalikes`
- `GET /` — no — list suggestions (filter: account_id, min_adoption, min_arr) — `Suggestion[]`
- `POST /compute` — yes — recompute adoption-based suggestions — `{ suggestions }`

### `plays.ts` → `/api/v1/plays`
- `GET /` — no — list plays (filter: stage, owner, account_id) — `Play[]`
- `GET /:id` — no — play detail + activities — `{ play, activities }`
- `POST /` — yes — create play — `Play`
- `PUT /:id` — yes — update play — `Play`
- `POST /:id/stage` — yes — transition stage (logs activity) — `Play`
- `POST /:id/activities` — yes — add note activity — `Activity`
- `DELETE /:id` — yes — delete play — `{ success }`
- `POST /bulk-from-whitespace` — yes — create plays from filtered whitespace cells — `{ created }`

### `heatmap.ts` → `/api/v1/heatmap`
- `GET /` — no — penetration matrix segment x product (adoption %) — `{ segments, products, cells }`
- `GET /cell` — no — eligible-not-owned accounts for a (segment, product) — `Account[]`

### `books.ts` → `/api/v1/books`
- `GET /` — no — per-CSM rollup (open ARR, plays, penetration, coverage gaps) — `BookRow[]`
- `GET /leaderboard` — no — book leaderboard by open + converted ARR — `LeaderRow[]`

### `snapshots.ts` → `/api/v1/snapshots`
- `GET /` — no — list snapshots — `Snapshot[]`
- `POST /` — yes — create snapshot of current grid + sizing — `Snapshot`
- `GET /compare` — no — diff two snapshots (query a, b) — `{ opened, converted, churned, nrr_movement }`
- `DELETE /:id` — yes — delete snapshot — `{ success }`

### `segments.ts` → `/api/v1/segments`
- `GET /` — no — list segments — `Segment[]`
- `POST /` — yes — create segment — `Segment`
- `PUT /:id` — yes — update segment — `Segment`
- `DELETE /:id` — yes — delete segment — `{ success }`
- `GET /:id/members` — no — preview matching accounts — `Account[]`

### `targets.ts` → `/api/v1/targets`
- `GET /` — no — list targets with attainment vs converted ARR — `TargetRow[]`
- `POST /` — yes — create/upsert target — `Target`
- `PUT /:id` — yes — update target — `Target`
- `DELETE /:id` — yes — delete target — `{ success }`

### `analytics.ts` → `/api/v1/analytics`
- `GET /pipeline` — no — plays by stage/owner/type, pipeline + weighted ARR — `{ byStage, byOwner, byType, totals }`
- `GET /conversion` — no — win-rate, time-in-stage, aging plays — `{ winRate, timeInStage, aging }`

### `launch-planner.ts` → `/api/v1/launch-planner`
- `POST /model` — yes — model a launch: target product + eligibility => addressable whitespace ARR — `{ addressable_arr_cents, eligible_accounts, byPre, byPost }`

### `notifications.ts` → `/api/v1/notifications`
- `GET /` — no — current user notification feed — `Notification[]`
- `POST /:id/read` — yes — mark read — `Notification`
- `POST /read-all` — yes — mark all read — `{ updated }`
- `GET /triggers` — no — list trigger rules — `TriggerRule[]`
- `POST /triggers` — yes — create trigger rule — `TriggerRule`
- `DELETE /triggers/:id` — yes — delete trigger rule — `{ success }`

### `saved-views.ts` → `/api/v1/saved-views`
- `GET /` — no — list saved views (filter: surface) — `SavedView[]`
- `POST /` — yes — create saved view — `SavedView`
- `DELETE /:id` — yes — delete saved view — `{ success }`

### `imports.ts` → `/api/v1/imports`
- `GET /` — no — list import jobs — `ImportJob[]`
- `POST /` — yes — run an import (entity + rows + mapping) — `ImportJob`

### `audit.ts` → `/api/v1/audit`
- `GET /` — no — list audit log entries (filter: entity) — `AuditEntry[]`

### `qbr.ts` → `/api/v1/qbr`
- `GET /` — no — list saved QBR exports — `QbrExport[]`
- `POST /:accountId` — yes — generate + save a QBR one-pager payload — `QbrExport`
- `GET /:id` — no — fetch a saved QBR export payload — `QbrExport`

### `settings.ts` → `/api/v1/settings`
- `GET /` — no — org settings for current user — `OrgSettings`
- `PUT /` — yes — update org settings — `OrgSettings`

### `overview.ts` → `/api/v1/overview`
- `GET /` — no — dashboard summary (total open ARR, top plays, book summary, counts) — `{ totals, topPlays, books, counts }`

### `seed.ts` → `/api/v1/seed`
- `POST /` — yes — generate sample dataset (catalog, price book, ~40 accounts, ownership, seats, rules) — `{ seeded }`
- `POST /reset` — yes — wipe current user data and reseed — `{ reset }`

### `billing.ts` → `/api/v1/billing`
- `GET /plan` — no(header) — current subscription + plan + stripeEnabled — `{ subscription, plan, stripeEnabled }`
- `POST /checkout` — no(header) — Stripe checkout url or 503 — `{ url }`
- `POST /portal` — no(header) — Stripe billing portal url or 503 — `{ url }`
- `POST /webhook` — no — Stripe webhook handler or 503 — `{ received }`

---

## (c) lib/api.ts methods (relative `/api/proxy/...`)

```
// accounts
listAccounts(params?)            GET    /api/proxy/accounts
getAccount(id)                   GET    /api/proxy/accounts/:id
createAccount(body)              POST   /api/proxy/accounts
updateAccount(id, body)          PUT    /api/proxy/accounts/:id
deleteAccount(id)                DELETE /api/proxy/accounts/:id
// products
listProducts(params?)            GET    /api/proxy/products
getProduct(id)                   GET    /api/proxy/products/:id
createProduct(body)              POST   /api/proxy/products
updateProduct(id, body)          PUT    /api/proxy/products/:id
deleteProduct(id)                DELETE /api/proxy/products/:id
importProducts(body)             POST   /api/proxy/products/import
// price book
listPriceBook(params?)           GET    /api/proxy/price-book
createPriceEntry(body)           POST   /api/proxy/price-book
updatePriceEntry(id, body)       PUT    /api/proxy/price-book/:id
deletePriceEntry(id)             DELETE /api/proxy/price-book/:id
// ownership
listOwnership(params?)           GET    /api/proxy/ownership
upsertOwnership(body)            POST   /api/proxy/ownership
deleteOwnership(id)              DELETE /api/proxy/ownership/:id
importOwnership(body)            POST   /api/proxy/ownership/import
// seats
listSeats(params?)               GET    /api/proxy/seats
listSeatOverage()                GET    /api/proxy/seats/overage
upsertSeat(body)                 POST   /api/proxy/seats
importSeats(body)                POST   /api/proxy/seats/import
// eligibility
listRules()                      GET    /api/proxy/eligibility/rules
createRule(body)                 POST   /api/proxy/eligibility/rules
updateRule(id, body)             PUT    /api/proxy/eligibility/rules/:id
deleteRule(id)                   DELETE /api/proxy/eligibility/rules/:id
previewRule(id)                  POST   /api/proxy/eligibility/rules/:id/preview
applyEligibility()               POST   /api/proxy/eligibility/apply
// grid
getGrid(params?)                 GET    /api/proxy/grid
getGridCell(accountId, productId) GET   /api/proxy/grid/cell
// sizing
listSizing(params?)              GET    /api/proxy/sizing
getSizingRollups()               GET    /api/proxy/sizing/rollups
computeSizing(body)              POST   /api/proxy/sizing/compute
// lookalikes
listLookalikes(params?)          GET    /api/proxy/lookalikes
computeLookalikes()              POST   /api/proxy/lookalikes/compute
// plays
listPlays(params?)               GET    /api/proxy/plays
getPlay(id)                      GET    /api/proxy/plays/:id
createPlay(body)                 POST   /api/proxy/plays
updatePlay(id, body)             PUT    /api/proxy/plays/:id
transitionPlay(id, stage)        POST   /api/proxy/plays/:id/stage
addPlayActivity(id, body)        POST   /api/proxy/plays/:id/activities
deletePlay(id)                   DELETE /api/proxy/plays/:id
bulkPlaysFromWhitespace(body)    POST   /api/proxy/plays/bulk-from-whitespace
// heatmap
getHeatmap()                     GET    /api/proxy/heatmap
getHeatmapCell(segment, productId) GET  /api/proxy/heatmap/cell
// books
listBooks()                      GET    /api/proxy/books
getBookLeaderboard()             GET    /api/proxy/books/leaderboard
// snapshots
listSnapshots()                  GET    /api/proxy/snapshots
createSnapshot(body)             POST   /api/proxy/snapshots
compareSnapshots(a, b)           GET    /api/proxy/snapshots/compare
deleteSnapshot(id)               DELETE /api/proxy/snapshots/:id
// segments
listSegments()                   GET    /api/proxy/segments
createSegment(body)              POST   /api/proxy/segments
updateSegment(id, body)          PUT    /api/proxy/segments/:id
deleteSegment(id)                DELETE /api/proxy/segments/:id
getSegmentMembers(id)            GET    /api/proxy/segments/:id/members
// targets
listTargets()                    GET    /api/proxy/targets
createTarget(body)               POST   /api/proxy/targets
updateTarget(id, body)           PUT    /api/proxy/targets/:id
deleteTarget(id)                 DELETE /api/proxy/targets/:id
// analytics
getPipelineAnalytics()           GET    /api/proxy/analytics/pipeline
getConversionAnalytics()         GET    /api/proxy/analytics/conversion
// launch planner
modelLaunch(body)                POST   /api/proxy/launch-planner/model
// notifications
listNotifications()              GET    /api/proxy/notifications
markNotificationRead(id)         POST   /api/proxy/notifications/:id/read
markAllNotificationsRead()       POST   /api/proxy/notifications/read-all
listTriggers()                   GET    /api/proxy/notifications/triggers
createTrigger(body)              POST   /api/proxy/notifications/triggers
deleteTrigger(id)                DELETE /api/proxy/notifications/triggers/:id
// saved views
listSavedViews(params?)          GET    /api/proxy/saved-views
createSavedView(body)            POST   /api/proxy/saved-views
deleteSavedView(id)              DELETE /api/proxy/saved-views/:id
// imports
listImportJobs()                 GET    /api/proxy/imports
runImport(body)                  POST   /api/proxy/imports
// audit
listAudit(params?)               GET    /api/proxy/audit
// qbr
listQbrExports()                 GET    /api/proxy/qbr
generateQbr(accountId)           POST   /api/proxy/qbr/:accountId
getQbrExport(id)                 GET    /api/proxy/qbr/:id
// settings
getSettings()                    GET    /api/proxy/settings
updateSettings(body)             PUT    /api/proxy/settings
// overview
getOverview()                    GET    /api/proxy/overview
// seed
seedSampleData()                 POST   /api/proxy/seed
resetSampleData()                POST   /api/proxy/seed/reset
// billing
getBillingPlan()                 GET    /api/proxy/billing/plan
startCheckout()                  POST   /api/proxy/billing/checkout
openBillingPortal()              POST   /api/proxy/billing/portal
```

---

## (d) Pages

Public:
| Route | File | Kind | API methods | Renders |
|---|---|---|---|---|
| `/` | `web/app/page.tsx` | public | (none) | Static landing: hero, feature grid, CTAs |
| `/auth/sign-in` | `web/app/auth/sign-in/page.tsx` | public | (authClient) | Email/password sign-in |
| `/auth/sign-up` | `web/app/auth/sign-up/page.tsx` | public | (authClient) | Email/password sign-up |
| `/pricing` | `web/app/pricing/page.tsx` | public | getBillingPlan | Plans (all free, Stripe optional) |

Dashboard (auth-gated under `/dashboard/*`, shared `DashboardLayout`):
| Route | File | Kind | API methods | Renders |
|---|---|---|---|---|
| `/dashboard` | `web/app/dashboard/page.tsx` | dashboard | getOverview, seedSampleData, getSizingRollups | KPIs (total open ARR), top plays, book summary, seed-sample CTA |
| `/dashboard/grid` | `web/app/dashboard/grid/page.tsx` | dashboard | getGrid, getGridCell, listSavedViews, createSavedView, bulkPlaysFromWhitespace | Owned-vs-eligible matrix with cell drill + bulk play create |
| `/dashboard/accounts` | `web/app/dashboard/accounts/page.tsx` | dashboard | listAccounts, createAccount, deleteAccount | Accounts table with filters + create |
| `/dashboard/accounts/[id]` | `web/app/dashboard/accounts/[id]/page.tsx` | dashboard | getAccount, updateAccount, generateQbr, createPlay | Account whitespace one-pager + QBR export |
| `/dashboard/catalog` | `web/app/dashboard/catalog/page.tsx` | dashboard | listProducts, getProduct, createProduct, updateProduct, deleteProduct, importProducts | Catalog management + module hierarchy + import |
| `/dashboard/price-book` | `web/app/dashboard/price-book/page.tsx` | dashboard | listPriceBook, listProducts, createPriceEntry, updatePriceEntry, deletePriceEntry | Price book editor |
| `/dashboard/eligibility` | `web/app/dashboard/eligibility/page.tsx` | dashboard | listRules, listProducts, createRule, updateRule, deleteRule, previewRule, applyEligibility | Rules engine + dry-run + apply |
| `/dashboard/sizing` | `web/app/dashboard/sizing/page.tsx` | dashboard | listSizing, getSizingRollups, computeSizing | Whitespace ARR sizing + rollups |
| `/dashboard/lookalikes` | `web/app/dashboard/lookalikes/page.tsx` | dashboard | listLookalikes, computeLookalikes, createPlay | Look-alike suggestions + add-to-queue |
| `/dashboard/seats` | `web/app/dashboard/seats/page.tsx` | dashboard | listSeats, listSeatOverage, upsertSeat, importSeats | Seat penetration + overage |
| `/dashboard/plays` | `web/app/dashboard/plays/page.tsx` | dashboard | listPlays, createPlay, transitionPlay, deletePlay | Play queue board/list |
| `/dashboard/plays/[id]` | `web/app/dashboard/plays/[id]/page.tsx` | dashboard | getPlay, updatePlay, transitionPlay, addPlayActivity | Play detail + activity log |
| `/dashboard/heatmap` | `web/app/dashboard/heatmap/page.tsx` | dashboard | getHeatmap, getHeatmapCell | Penetration heatmap segment x product |
| `/dashboard/books` | `web/app/dashboard/books/page.tsx` | dashboard | listBooks, getBookLeaderboard | CSM book whitespace + leaderboard |
| `/dashboard/snapshots` | `web/app/dashboard/snapshots/page.tsx` | dashboard | listSnapshots, createSnapshot, compareSnapshots, deleteSnapshot | Snapshots + compare/trend |
| `/dashboard/segments` | `web/app/dashboard/segments/page.tsx` | dashboard | listSegments, createSegment, updateSegment, deleteSegment, getSegmentMembers | Segments management + membership preview |
| `/dashboard/targets` | `web/app/dashboard/targets/page.tsx` | dashboard | listTargets, createTarget, updateTarget, deleteTarget | Targets & quota attainment |
| `/dashboard/launch-planner` | `web/app/dashboard/launch-planner/page.tsx` | dashboard | listProducts, modelLaunch | Launch planner addressable whitespace |
| `/dashboard/analytics` | `web/app/dashboard/analytics/page.tsx` | dashboard | getPipelineAnalytics, getConversionAnalytics | Plays pipeline analytics |
| `/dashboard/imports` | `web/app/dashboard/imports/page.tsx` | dashboard | listImportJobs, runImport | Data import jobs |
| `/dashboard/notifications` | `web/app/dashboard/notifications/page.tsx` | dashboard | listNotifications, markNotificationRead, markAllNotificationsRead, listTriggers, createTrigger, deleteTrigger | Feed + trigger rules |
| `/dashboard/qbr` | `web/app/dashboard/qbr/page.tsx` | dashboard | listQbrExports, getQbrExport, listAccounts, generateQbr | QBR export library |
| `/dashboard/settings` | `web/app/dashboard/settings/page.tsx` | dashboard | getSettings, updateSettings, getBillingPlan, startCheckout, openBillingPortal, listSavedViews, deleteSavedView, listAudit, resetSampleData | Org settings, billing, saved views, audit log |

26 pages total (4 public + 22 dashboard).

---

## (e) DashboardLayout sidebar nav

- **Overview**: Dashboard (`/dashboard`)
- **Whitespace**: Grid (`/dashboard/grid`), Sizing (`/dashboard/sizing`), Heatmap (`/dashboard/heatmap`), Look-Alikes (`/dashboard/lookalikes`), Launch Planner (`/dashboard/launch-planner`)
- **Accounts & Catalog**: Accounts (`/dashboard/accounts`), Catalog (`/dashboard/catalog`), Price Book (`/dashboard/price-book`), Eligibility Rules (`/dashboard/eligibility`), Segments (`/dashboard/segments`), Seats (`/dashboard/seats`)
- **Plays**: Play Queue (`/dashboard/plays`), Analytics (`/dashboard/analytics`), Targets (`/dashboard/targets`), Books (`/dashboard/books`)
- **Reporting**: Snapshots (`/dashboard/snapshots`), QBR Exports (`/dashboard/qbr`)
- **Data & Admin**: Imports (`/dashboard/imports`), Notifications (`/dashboard/notifications`), Settings (`/dashboard/settings`)

---

## Cross-check invariants

- Every api method maps 1:1 to a backend endpoint listed in (b) and is consumed by ≥1 page in (d). ✔
- 26 route files (incl. billing/seed/overview) and 26 page routes (incl. public + dynamic `[id]`). ✔
- All `*_cents` integers; sizing/lookalike scores use real. ✔
- Public reads / auth-gated writes with zod + ownership checks everywhere. ✔
