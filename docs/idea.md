# Expansion Whitespace Mapper

## Overview

Expansion Whitespace Mapper turns every customer account into a visible owned-vs-eligible product grid. For multi-product B2B SaaS companies, it maps which SKUs, modules, and seat tiers each account already owns against everything that account is *eligible* to buy, computes the open expansion ARR in each empty ("whitespace") cell, and turns those cells into a tracked queue of cross-sell and upsell plays. The result is a single, deterministic, account-planning surface that account managers and CS leaders can run monthly to find the cheapest growth dollar in their book.

The product is deterministic by design: all whitespace sizing, look-alike suggestions, and penetration scores are computed from explicit, inspectable rules over uploaded, connected, or generated data. There is no opaque ML scoring; every number traces back to a product catalog, an eligibility rule, a price book entry, and an account's owned set. A built-in sample-data seeder makes the whole product demoable on first sign-in.

## Problem

Multi-product SaaS teams cannot see, at a glance, which products each account has *not* bought, whether the account is even eligible for them, and how much expansion ARR that gap represents. Today this lives in spreadsheets that go stale the moment a deal closes, in CRM opportunity records that only capture pipeline already in motion (not latent whitespace), and in the heads of individual AMs. Cross-sell and upsell become guesswork:

- AMs do not know which of their accounts are the best look-alikes for a module that just launched.
- CS leaders cannot quota a book of business against whitespace because nobody has sized it.
- Seat-based products silently leak revenue when active usage exceeds licensed seats (overage) or when licensed seats sit unused (downsell risk masking upsell).
- QBR prep is manual: building an account whitespace one-pager takes hours per account.

The cost of the gap is high precisely because expansion is the cheapest growth dollar: a single created cross-sell deal pays for the tool many times over, and the planning cadence (monthly to quarterly) means the tool is used repeatedly.

## Target Users

- **Heads of Account Management** at multi-product B2B SaaS ($10M-$100M ARR) who carry expansion quotas and run account planning.
- **VPs / Directors of Customer Success** where Net Revenue Retention (NRR) and expansion are explicit board-level targets.
- **RevOps / CS Ops** analysts who maintain the product catalog, eligibility rules, and price book, and who build the reporting.
- **Individual AMs / CSMs** who work an assigned book and need a play queue per account.

### Buyer

The economic buyer is the Head of Account Management or VP/Director of CS where expansion and NRR are explicit quotas and who owns a CS/AM tooling budget. Triggers that create urgency: a multi-product launch (suddenly there is a new whitespace column across the whole base), a CRO expansion mandate, or a board NRR target.

## Why This Is NOT an Existing Project

The nearest neighbors and why this is distinct:

- **customer-segmentation / crm-platform (corpus neighbors):** Those segment and manage customer records and pipeline. They do not maintain a product catalog with eligibility rules and a price book, and they do not compute owned-vs-eligible whitespace ARR per cell. We are an expansion-planning layer, not a CRM or a segmentation engine.
- **entitlement-leak-detector (nearest base):** That reconciles *plan-entitled vs actually-used* metering to find leaks and overages on products the customer *already owns*. We map *owned vs eligible across the whole SKU catalog* for **net-new cross-sell** the customer does **not** own yet. Different axis: metering reconciliation vs catalog whitespace.
- **onboarding-time-to-value-tracker (sibling):** Tracks implementation milestones and time-to-value on products being onboarded. It says nothing about which other products an account could buy.
- **escalation-debt-ledger (sibling):** Tracks support escalations and their accumulated "debt." Orthogonal to expansion whitespace.

The defensible core: a **product catalog + eligibility rules + price book + account ownership** model that deterministically produces an **owned/eligible-not-owned/N-A grid**, sizes the **open expansion ARR** per cell and per book, and converts cells into **tracked plays**. Seat penetration (licensed vs active) is folded in as an upsell/overage axis, not as the whole product. No competitor in the set combines catalog whitespace mapping, deterministic look-alike suggestion, and a play queue.

## Major Features

### 1. Product Catalog Management
- CRUD for products/SKUs/modules with `sku_code`, name, description, category, product family.
- Module hierarchy: a product can have child modules; modules roll up to a parent product.
- Seat-based vs flat-fee vs usage-based product types.
- Active/retired lifecycle flags so retired SKUs drop out of whitespace.
- Bulk import of catalog via CSV/JSON paste.
- Catalog versioning notes and last-changed audit.

### 2. Price Book
- Per-product list price, with currency and billing term (monthly/annual).
- Per-segment price overrides (e.g., enterprise vs mid-market list price).
- Seat-tier pricing bands (1-10, 11-50, 51+ price-per-seat).
- Effective-dated price entries (price changes over time).
- Default expansion-ARR assumption per product used when no account-specific estimate exists.

### 3. Account Ownership Grid
- The core matrix: rows = accounts, columns = products/modules, cell state = `owned | eligible_not_owned | not_applicable`.
- Per-cell owned quantity (seats / units) and owned ARR.
- Filter the grid by segment, CSM owner, region, industry, plan tier.
- Drill from any cell into the account x product detail.
- Color-coded whitespace heat (owned = filled, eligible-not-owned = open whitespace, N/A = greyed).

### 4. Eligibility Rules Engine
- Deterministic, inspectable rules that decide whether an account is *eligible* for a product it does not own.
- Rule conditions on account attributes: segment, industry, employee band, region, current product set ("owns X => eligible for Y").
- Rule actions: mark product eligible / not-applicable for matching accounts.
- Priority ordering and first-match / all-match evaluation modes.
- Dry-run preview: show how many accounts/cells a rule would change before applying.
- Per-cell "why eligible / why N/A" explanation trace.

### 5. Whitespace ARR Sizing
- For each `eligible_not_owned` cell, compute the open expansion ARR using price book + seat assumptions + segment overrides.
- Roll up open ARR per account, per CSM book, per segment, and total.
- Configurable sizing method: list-price x assumed seats, fixed expansion assumption, or comparable-account median.
- Confidence band (low/expected/high) per sized cell.
- Re-size on demand and snapshot the result for trend tracking.

### 6. Look-Alike Play Suggester
- Deterministic same-segment adoption rules: "X% of accounts in segment S that own A also own B; account does not own B => suggest B."
- Adoption-rate computation per (segment, product) pair from current ownership.
- Rank suggestions per account by adoption rate x open ARR.
- Threshold controls (minimum adoption rate, minimum ARR) to filter noise.
- Explanation: every suggestion shows the supporting adoption stat and peer count.

### 7. Seat Penetration Tracker
- Per account x seat-based-product: licensed seats vs active seats vs assigned seats.
- Penetration ratio (active / licensed) and over-provisioning flag (low utilization).
- Overage detection (active > licensed) sized as immediate upsell ARR.
- Seat-expansion runway (assigned approaching licensed => upsell trigger).
- Trend of seat counts over snapshots.

### 8. Expansion Play Queue
- Turn any whitespace cell or look-alike suggestion into a tracked **play**.
- Play fields: account, product, type (cross-sell/upsell/seat-expansion), open ARR, stage, owner, due date, notes.
- Stages: identified -> qualified -> proposed -> won -> lost.
- Per-play activity log and stage-change history.
- Assign plays to CSM owners; bulk-create plays from filtered whitespace.

### 9. Penetration Heatmap By Segment
- Matrix of segment (rows) x product (columns) showing adoption % (owned accounts / eligible accounts).
- Identify under-penetrated (product, segment) combinations as macro whitespace.
- Drill from a heatmap cell into the list of eligible-not-owned accounts.
- Compare penetration across snapshots to see movement.

### 10. CSM Book Whitespace View
- Per-CSM rollup: total open ARR, top plays, penetration vs peers.
- Book-level leaderboard of open whitespace and converted ARR.
- Coverage gaps: accounts in book with no plays created.

### 11. Account Detail / Whitespace One-Pager
- Per-account page: owned products, eligible-not-owned with sized ARR, seat penetration, active plays, look-alike suggestions.
- QBR-ready summary block (total open ARR, top 3 plays).
- Account attributes (segment, industry, region, employees, current ARR).

### 12. QBR One-Pager Export
- Generate a per-account whitespace one-pager as a structured export (HTML/printable view + JSON payload).
- Includes owned grid, sized whitespace, top plays, seat penetration, and look-alikes.
- Saved export records with timestamp for audit / re-download.

### 13. Snapshots & Trend Tracking
- Point-in-time snapshot of the whole grid + sized ARR + penetration.
- Compare two snapshots: new whitespace opened, whitespace converted (won), churned ownership.
- NRR-style movement summary (expansion ARR won between snapshots).

### 14. Segments & Account Attributes
- Define segments (rules over account attributes) used everywhere (eligibility, look-alike, heatmap).
- Manage account attribute schema (industry, region, employee band, plan tier).
- Segment membership preview.

### 15. Data Import / Connectors (Deterministic)
- CSV/JSON import for accounts, ownership, seat usage, catalog, price book.
- Field-mapping step for imports.
- Import job records with row counts and error rows.
- Idempotent upsert keyed on external ids.

### 16. Sample-Data Seeder
- One-click generate a realistic demo dataset: catalog, price book, ~40 accounts across segments, ownership grid, seat usage, eligibility rules.
- Lets a brand-new signed-in user see a fully populated whitespace map immediately.
- Reset/regenerate sample data.

### 17. Plays Pipeline Analytics
- Aggregate plays by stage, owner, type; total pipeline ARR and weighted ARR.
- Win-rate and conversion from identified -> won.
- Time-in-stage and aging plays.

### 18. Targets & Quota Tracking
- Set expansion ARR targets per CSM, per segment, per period.
- Track converted (won) ARR against target; attainment %.
- Surface books behind pace.

### 19. Notifications & Triggers
- Per-user notification feed: new whitespace opened (catalog launch), seat overage detected, play stage changes, aging plays.
- Mark-read / unread.
- Trigger rules: "notify owner when an account crosses 90% seat utilization."

### 20. Saved Views & Filters
- Save grid/heatmap filter combinations as named views.
- Quick filters: my book, top open ARR, under-penetrated segments.
- Share a saved view (by id) read-only.

### 21. Catalog Launch Planner
- Model a new product launch: pick a product (or new candidate), apply eligibility rules, instantly see total addressable whitespace ARR across the base.
- Pre-launch vs post-launch whitespace comparison.

### 22. Audit Log & Settings
- Org-level settings: default currency, sizing method, billing term assumptions.
- Audit log of rule changes, price changes, and play stage changes.
- Billing/plan page (all features free; Stripe optional, returns 503 when unconfigured).

## Data Model (Tables)

- `accounts` — customer accounts with segment, industry, region, employees, current ARR, external id, CSM owner.
- `products` — catalog SKUs/modules: sku_code, name, category, family, product_type, parent_product_id, is_active.
- `price_book` — per-product/segment effective-dated prices, currency, term, per-seat band, default expansion ARR.
- `ownership` — account x product owned cells: quantity, owned ARR, owned_since.
- `seat_usage` — account x product seat metrics: licensed, active, assigned seats, as-of date.
- `eligibility_rules` — deterministic rules: conditions (jsonb), action (eligible/na), priority, mode, active.
- `eligibility_cells` — materialized per account x product eligibility state + explanation (owned/eligible_not_owned/not_applicable).
- `whitespace_sizing` — per eligible cell sized open ARR, method, confidence, snapshot_id.
- `lookalike_suggestions` — per account x product suggestion with adoption rate, peer count, score.
- `plays` — expansion plays: account, product, type, open ARR, stage, owner, due date.
- `play_activities` — activity / stage-change log per play.
- `segments` — named segments defined by attribute rules.
- `snapshots` — point-in-time grid + sizing snapshots.
- `targets` — expansion ARR targets per owner/segment/period.
- `notifications` — per-user notification feed.
- `trigger_rules` — notification trigger definitions.
- `saved_views` — named saved filter combinations.
- `import_jobs` — data import job records with counts and errors.
- `audit_log` — org-level audit entries.
- `plans` — billing plans (free/pro).
- `subscriptions` — per-user subscription state.

## API Surface (high level)

- Accounts CRUD + filtered list + detail with rollups.
- Products (catalog) CRUD + bulk import + module hierarchy.
- Price book CRUD + effective-dated lookup.
- Ownership grid read + cell upsert + bulk import.
- Seat usage read/upsert + penetration computation + overage list.
- Eligibility rules CRUD + dry-run preview + apply (materialize cells).
- Eligibility cells read (the grid) + per-cell explanation.
- Whitespace sizing compute + rollups (account/CSM/segment/total).
- Look-alike compute + per-account suggestions.
- Plays CRUD + stage transitions + activities + bulk-create-from-whitespace.
- Penetration heatmap (segment x product).
- CSM book rollups + leaderboard.
- Snapshots create/list/compare.
- Segments CRUD + membership preview.
- Targets CRUD + attainment.
- Notifications list/mark-read + trigger rules CRUD.
- Saved views CRUD.
- Import jobs create/list.
- Audit log list.
- Launch planner compute.
- Sample-data seed/reset.
- Billing plan/checkout/portal/webhook.

## Frontend Pages (~22-26)

Public:
1. `/` — static landing page.
2. `/auth/sign-in` — sign in.
3. `/auth/sign-up` — sign up.
4. `/pricing` — pricing (all free, Stripe optional).

Dashboard (auth-gated, under `/dashboard/*` with shared sidebar):
5. `/dashboard` — overview: total open whitespace ARR, top plays, book summary, quick actions including seed sample data.
6. `/dashboard/grid` — the owned-vs-eligible whitespace grid.
7. `/dashboard/accounts` — accounts list with filters.
8. `/dashboard/accounts/[id]` — account detail / whitespace one-pager.
9. `/dashboard/catalog` — product catalog management.
10. `/dashboard/price-book` — price book.
11. `/dashboard/eligibility` — eligibility rules engine + dry-run.
12. `/dashboard/sizing` — whitespace ARR sizing + rollups.
13. `/dashboard/lookalikes` — look-alike play suggestions.
14. `/dashboard/seats` — seat penetration tracker + overage.
15. `/dashboard/plays` — expansion play queue (board/list).
16. `/dashboard/plays/[id]` — play detail + activity log.
17. `/dashboard/heatmap` — penetration heatmap by segment.
18. `/dashboard/books` — CSM book whitespace view + leaderboard.
19. `/dashboard/snapshots` — snapshots + compare.
20. `/dashboard/segments` — segments management.
21. `/dashboard/targets` — targets & quota tracking.
22. `/dashboard/launch-planner` — catalog launch planner.
23. `/dashboard/analytics` — plays pipeline analytics.
24. `/dashboard/imports` — data import jobs.
25. `/dashboard/notifications` — notifications feed + trigger rules.
26. `/dashboard/settings` — org settings + saved views + billing + audit log link.
