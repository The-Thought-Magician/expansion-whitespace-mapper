import Link from 'next/link'

const FEATURES = [
  {
    title: 'Owned-vs-Eligible Grid',
    body: 'Every account becomes a matrix of products it owns versus everything it is eligible to buy. Whitespace cells are color-coded and drillable.',
  },
  {
    title: 'Eligibility Rules Engine',
    body: 'Deterministic, inspectable rules over account attributes and current product set. Dry-run a rule before applying and trace every "why eligible".',
  },
  {
    title: 'Whitespace ARR Sizing',
    body: 'Size the open expansion ARR in each empty cell from your price book and seat assumptions. Roll up by account, CSM book, segment, and total.',
  },
  {
    title: 'Look-Alike Suggester',
    body: 'Same-segment adoption rules surface the next best product per account, ranked by adoption rate times open ARR, with the supporting peer stat.',
  },
  {
    title: 'Seat Penetration & Overage',
    body: 'Track licensed vs active vs assigned seats per account. Detect overage as immediate upsell and flag seat-expansion runway.',
  },
  {
    title: 'Expansion Play Queue',
    body: 'Turn any whitespace cell into a tracked play with stages, owners, and a full activity log. Bulk-create plays from filtered whitespace.',
  },
  {
    title: 'Penetration Heatmap',
    body: 'Segment x product adoption matrix exposes under-penetrated combinations as macro whitespace. Drill into eligible-not-owned accounts.',
  },
  {
    title: 'CSM Book View & Targets',
    body: 'Per-CSM open ARR, coverage gaps, and a leaderboard. Set expansion targets per owner, segment, and period and track attainment.',
  },
  {
    title: 'Snapshots & Trend',
    body: 'Point-in-time snapshots of the grid and sizing. Compare two snapshots to see whitespace opened, converted, and NRR-style movement.',
  },
  {
    title: 'Launch Planner',
    body: 'Model a new product launch: apply eligibility and instantly see total addressable whitespace ARR across the base, pre vs post launch.',
  },
  {
    title: 'QBR One-Pager Export',
    body: 'Generate a per-account whitespace one-pager: owned grid, sized whitespace, top plays, seat penetration, and look-alikes.',
  },
  {
    title: 'Deterministic by Design',
    body: 'No opaque ML. Every number traces back to a catalog, an eligibility rule, a price book entry, and an account’s owned set.',
  },
]

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <nav className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <span className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500 to-indigo-600 text-sm font-black text-white">
            E
          </span>
          <span className="text-lg font-bold">ExpansionWhitespaceMapper</span>
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
            className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500"
          >
            Get Started
          </Link>
        </div>
      </nav>

      <section className="mx-auto max-w-5xl px-6 py-24 text-center">
        <span className="inline-flex items-center rounded-full border border-purple-500/30 bg-purple-500/10 px-3 py-1 text-xs font-medium text-purple-300">
          Account expansion, deterministically sized
        </span>
        <h1 className="mt-6 text-4xl font-black leading-tight tracking-tight sm:text-6xl">
          Find the cheapest growth dollar in your book.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-400">
          ExpansionWhitespaceMapper turns every account into a visible owned-vs-eligible product grid, sizes the open
          expansion ARR in each whitespace cell, and converts those cells into a tracked queue of cross-sell and upsell
          plays.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/auth/sign-up"
            className="rounded-lg bg-purple-600 px-6 py-3 text-sm font-semibold text-white hover:bg-purple-500"
          >
            Start mapping whitespace
          </Link>
          <Link
            href="/auth/sign-in"
            className="rounded-lg border border-slate-700 px-6 py-3 text-sm font-semibold text-slate-200 hover:bg-slate-800"
          >
            Sign In
          </Link>
        </div>
      </section>

      <section className="border-t border-slate-800 bg-slate-900/30 px-6 py-20">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="text-2xl font-bold sm:text-3xl">Expansion is guesswork without a whitespace map</h2>
          <p className="mt-4 text-slate-400">
            Whitespace lives in spreadsheets that go stale the moment a deal closes, in CRM records that only capture
            pipeline already in motion, and in the heads of individual account managers. Nobody can see which products an
            account has not bought, whether it is even eligible, or how much expansion ARR that gap represents.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="text-center">
          <h2 className="text-2xl font-bold sm:text-3xl">One deterministic account-planning surface</h2>
          <p className="mx-auto mt-3 max-w-2xl text-slate-400">
            Catalog, eligibility rules, price book, and ownership combine into a single grid you can run every month.
          </p>
        </div>
        <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 transition-colors hover:border-purple-500/40"
            >
              <h3 className="text-base font-semibold text-white">{f.title}</h3>
              <p className="mt-2 text-sm text-slate-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-slate-800 px-6 py-20">
        <div className="mx-auto max-w-3xl rounded-2xl border border-purple-500/30 bg-gradient-to-br from-purple-600/10 to-indigo-600/10 p-10 text-center">
          <h2 className="text-2xl font-bold sm:text-3xl">See a fully populated whitespace map in seconds</h2>
          <p className="mx-auto mt-3 max-w-xl text-slate-400">
            Sign up and seed a realistic demo dataset with one click: a catalog, price book, ~40 accounts, ownership,
            seats, and eligibility rules. All features are free.
          </p>
          <Link
            href="/auth/sign-up"
            className="mt-7 inline-block rounded-lg bg-purple-600 px-6 py-3 text-sm font-semibold text-white hover:bg-purple-500"
          >
            Create your free account
          </Link>
        </div>
      </section>

      <footer className="border-t border-slate-800 py-10 text-center text-sm text-slate-600">
        <p>ExpansionWhitespaceMapper</p>
      </footer>
    </main>
  )
}
