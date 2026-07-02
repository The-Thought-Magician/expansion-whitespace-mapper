import Link from 'next/link'

const FEATURES = [
  {
    title: 'Owned-vs-Eligible Grid',
    body: 'Every account is rendered as a matrix of products it owns against everything it is eligible to buy. Whitespace cells are color-coded and drillable, giving your team a single source of truth for account planning.',
  },
  {
    title: 'Eligibility Rules Engine',
    body: 'A deterministic, fully inspectable rules layer evaluates account attributes and current product holdings. Dry-run any rule before applying it, and trace the exact logic behind every "eligible" determination.',
  },
  {
    title: 'Whitespace ARR Sizing',
    body: 'Quantify the open expansion ARR in each empty cell against your price book and seat assumptions, then roll figures up by account, CSM book, segment, and total portfolio.',
  },
  {
    title: 'Look-Alike Suggester',
    body: 'Same-segment adoption patterns surface the next best product for each account, ranked by adoption rate multiplied by open ARR, with the supporting peer evidence attached.',
  },
  {
    title: 'Seat Penetration & Overage',
    body: 'Monitor licensed, active, and assigned seats per account. Overage is flagged as immediate upsell; unused seat runway is flagged before it becomes a downsell risk.',
  },
  {
    title: 'Expansion Play Queue',
    body: 'Convert any whitespace cell into a tracked play with stages, owners, and a full activity log. Bulk-create plays directly from a filtered whitespace view.',
  },
  {
    title: 'Penetration Heatmap',
    body: 'A segment-by-product adoption matrix exposes under-penetrated combinations as macro-level whitespace, with drill-down into the eligible-not-owned accounts behind each figure.',
  },
  {
    title: 'CSM Book View & Targets',
    body: 'Per-owner open ARR, coverage gaps, and a performance leaderboard. Set expansion targets by owner, segment, and period, and track attainment against them.',
  },
  {
    title: 'Snapshots & Trend',
    body: 'Point-in-time snapshots of the grid and its sizing. Compare any two snapshots to see whitespace opened, whitespace converted, and NRR-relevant movement over time.',
  },
  {
    title: 'Launch Planner',
    body: 'Model a new product launch before it ships: apply eligibility rules and see total addressable whitespace ARR across the base, pre- and post-launch.',
  },
  {
    title: 'QBR One-Pager Export',
    body: 'Generate a per-account whitespace brief on demand: owned grid, sized whitespace, top plays, seat penetration, and look-alikes, ready for the quarterly business review.',
  },
  {
    title: 'Deterministic by Design',
    body: 'No opaque scoring models. Every figure traces back to a product catalog entry, an eligibility rule, a price book entry, and an account\'s documented ownership record.',
  },
]

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <nav className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <span className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-600 text-sm font-black text-white">
            E
          </span>
          <span className="text-lg font-bold tracking-tight">ExpansionWhitespaceMapper</span>
        </span>
        <div className="flex items-center gap-3">
          <Link href="/pricing" className="text-sm text-slate-300 hover:text-white">
            Pricing
          </Link>
          <Link href="/auth/sign-in" className="text-sm text-slate-300 hover:text-white">
            Sign In
          </Link>
          <Link
            href="/auth/sign-up"
            className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500"
          >
            Request Access
          </Link>
        </div>
      </nav>

      <section className="mx-auto max-w-5xl px-6 py-24 text-center">
        <span className="inline-flex items-center rounded-full border border-brand-500/30 bg-brand-500/10 px-3 py-1 text-xs font-medium text-brand-300">
          Account expansion planning, deterministically sized
        </span>
        <h1 className="mt-6 text-4xl font-black leading-tight tracking-tight sm:text-6xl">
          A defensible source of truth for expansion ARR
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-400">
          ExpansionWhitespaceMapper gives account management and customer success leaders a single, auditable view of
          every account&rsquo;s owned-versus-eligible product footprint. It sizes the open expansion ARR behind each
          whitespace cell and converts that analysis into a governed queue of cross-sell and upsell plays, so quota
          conversations are grounded in evidence rather than intuition.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/auth/sign-up"
            className="rounded-xl bg-brand-600 px-6 py-3 text-sm font-semibold text-white hover:bg-brand-500"
          >
            Request a walkthrough
          </Link>
          <Link
            href="/auth/sign-in"
            className="rounded-xl border border-slate-700 px-6 py-3 text-sm font-semibold text-slate-200 hover:bg-slate-800"
          >
            Sign In
          </Link>
        </div>
      </section>

      <section className="border-t border-slate-800 bg-slate-900/30 px-6 py-20">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="text-2xl font-bold sm:text-3xl">The expansion opportunity your systems cannot see</h2>
          <p className="mt-4 text-slate-400">
            For most multi-product organizations, whitespace is tracked in spreadsheets that go stale the moment a
            deal closes, or in CRM opportunity records that only reflect pipeline already in motion. Neither answers
            the questions that matter to a board-level NRR target: which products has this account not purchased,
            is it even eligible, and what is that gap worth. Left unanswered, those questions become guesswork
            distributed across individual account managers rather than a governed, repeatable process.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="text-center">
          <h2 className="text-2xl font-bold sm:text-3xl">One operating surface for account planning</h2>
          <p className="mx-auto mt-3 max-w-2xl text-slate-400">
            Product catalog, eligibility rules, price book, and account ownership converge into a single grid your
            team can review on a monthly or quarterly cadence, with full traceability behind every number.
          </p>
        </div>
        <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 transition-colors hover:border-brand-500/40"
            >
              <h3 className="text-base font-semibold text-white">{f.title}</h3>
              <p className="mt-2 text-sm text-slate-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-slate-800 px-6 py-20">
        <div className="mx-auto max-w-3xl rounded-2xl border border-brand-500/30 bg-gradient-to-br from-brand-600/10 to-slate-800/20 p-10 text-center">
          <h2 className="text-2xl font-bold sm:text-3xl">Evaluate the platform against a fully populated model</h2>
          <p className="mx-auto mt-3 max-w-xl text-slate-400">
            Sign up and seed a representative demo dataset in one click: a product catalog, price book, roughly forty
            sample accounts, ownership records, seat data, and eligibility rules. All capabilities are available at
            no cost during evaluation.
          </p>
          <Link
            href="/auth/sign-up"
            className="mt-7 inline-block rounded-xl bg-brand-600 px-6 py-3 text-sm font-semibold text-white hover:bg-brand-500"
          >
            Create your account
          </Link>
        </div>
      </section>

      <footer className="border-t border-slate-800 py-10 text-center text-sm text-slate-600">
        <p>ExpansionWhitespaceMapper</p>
      </footer>
    </main>
  )
}
