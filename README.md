# Expansion Whitespace Mapper

Expansion Whitespace Mapper turns every customer account into a visible owned-vs-eligible product grid. For multi-product B2B SaaS companies, it maps which SKUs, modules, and seat tiers each account already owns against everything that account is eligible to buy, computes the open expansion ARR in each empty (whitespace) cell, and turns those cells into a tracked queue of cross-sell and upsell plays. The result is a single, deterministic account-planning surface that account managers and CS leaders can run monthly to find the cheapest growth dollar in their book.

The product is deterministic by design. All whitespace sizing, look-alike suggestions, and penetration scores are computed from explicit, inspectable rules over uploaded, connected, or generated data. There is no opaque ML scoring; every number traces back to a product catalog, an eligibility rule, a price book entry, and an account's owned set. A built-in sample-data seeder makes the whole product demoable on first sign-in.

See `docs/idea.md` for the full product specification (22 major features, data model, API surface, and frontend page list).

## Features

- Product catalog management with SKU/module hierarchy and lifecycle flags
- Price book with per-segment overrides, seat-tier bands, and effective-dated entries
- Account ownership grid: owned vs eligible-not-owned vs not-applicable per cell
- Deterministic eligibility rules engine with dry-run preview and explanation traces
- Whitespace ARR sizing with configurable methods and confidence bands
- Look-alike play suggester driven by same-segment adoption rates
- Seat penetration tracker with overage and over-provisioning detection
- Expansion play queue with stages, owners, and activity history
- Penetration heatmap by segment, CSM book whitespace views, and leaderboards
- Account whitespace one-pager and QBR export
- Snapshots and trend tracking with NRR-style movement summaries
- Segments, targets and quota tracking, notifications and trigger rules
- Saved views, data import jobs, catalog launch planner, and an audit log
- One-click sample-data seeder for an instantly populated demo

## Stack

- **Backend:** Hono (Node, ESM) + Drizzle ORM over Neon Postgres, run with `tsx`.
- **Frontend:** Next.js 16 (App Router), React 19, TypeScript (strict), Tailwind 4.
- **Auth:** Neon Auth (`@neondatabase/auth`). The Next.js proxy route resolves the session server-side and forwards an `X-User-Id` header to the backend, which trusts it.
- **Package managers:** pnpm for Node, uv for any optional Python scripts.

## Project Layout

```
backend/   Hono API server (src/index.ts bootstrap, routes/, db/)
web/       Next.js app (app/, lib/)
docs/      idea.md (spec) and build-plan.md
```

## Local Development

Prerequisites: Node 22+, pnpm, and a Neon Postgres database URL. The app does not create its own tables; provision the Drizzle schema against your database before first boot (drizzle-kit push or the Neon console).

### Backend

```bash
cd backend
pnpm install
cp .env.example .env   # then fill in DATABASE_URL and FRONTEND_URL
pnpm dev               # node --import tsx/esm src/index.ts
```

The backend listens on `PORT` (default 3001) and serves the API under `/api/v1`, with a health check at `/health`. On first boot the sample-data seeder populates a demo dataset if the database is empty.

### Frontend

```bash
cd web
pnpm install
cp .env.example .env.local   # then fill in the values below
pnpm dev                     # next dev on http://localhost:3000
pnpm build                   # production build
```

### Docker

```bash
docker compose up --build
```

Brings up the backend on `:3001` and the web app on `:3000` together.

## Environment Variables

### Backend (`backend/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | yes | Neon Postgres connection string (`?sslmode=require`). |
| `PORT` | no | Listen port. Defaults to 3001 locally; Render injects 10000. |
| `FRONTEND_URL` | no | Allowed CORS origin. Defaults to `http://localhost:3000`. |
| `ADMIN_USER_IDS` | no | Comma-separated user ids granted admin endpoints. |

### Frontend (`web/.env.local`)

| Variable | Required | Description |
|----------|----------|-------------|
| `NEON_AUTH_BASE_URL` | yes | Neon Auth endpoint base URL (server-only). |
| `NEON_AUTH_COOKIE_SECRET` | yes | Random 32-byte hex cookie secret (server-only). |
| `NEXT_PUBLIC_API_URL` | yes | Backend base URL, baked into the bundle and read by the proxy route. |

## Billing

All features are free for signed-in users. The billing/plan endpoint always reports the free plan. Stripe is optional: checkout, portal, and webhook routes return `503` when `STRIPE_SECRET_KEY` is unconfigured, so the product is fully usable without any payment setup.

## Deployment

- **Backend:** Render web service defined in `render.yaml` (`expansion-whitespace-mapper-api`). Set `DATABASE_URL` and `FRONTEND_URL` as Render environment variables (`sync: false`).
- **Frontend:** Vercel, with project `rootDirectory` set to `web`, framework `nextjs`, and Node 22.x. Set the production env values in `web/.env.local` before building, since `NEXT_PUBLIC_*` values are baked at build time.
