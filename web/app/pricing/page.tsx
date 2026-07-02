'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'

const INCLUDED = [
  'Owned-vs-eligible product grid',
  'Eligibility rules engine with dry-run preview',
  'Whitespace ARR sizing & rollups',
  'Look-alike play suggester',
  'Seat penetration & overage tracking',
  'Expansion play queue & pipeline analytics',
  'Penetration heatmap by segment',
  'CSM book views, targets & leaderboard',
  'Snapshots, trend tracking & launch planner',
  'QBR one-pager exports',
  'CSV/JSON imports & sample-data seeder',
  'Notifications, triggers & audit log',
]

export default function Pricing() {
  const [stripeEnabled, setStripeEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/proxy/billing/plan')
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) setStripeEnabled(Boolean(data?.stripeEnabled))
      } catch {
        // pricing is informational; ignore failures (e.g. signed-out 401)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <nav className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-600 text-sm font-black text-white">
            E
          </span>
          <span className="text-lg font-bold">ExpansionWhitespaceMapper</span>
        </Link>
        <div className="flex items-center gap-3">
          <Link href="/auth/sign-in" className="text-sm text-slate-300 hover:text-white">
            Sign In
          </Link>
          <Link
            href="/auth/sign-up"
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500"
          >
            Get Started
          </Link>
        </div>
      </nav>

      <section className="mx-auto max-w-3xl px-6 py-20 text-center">
        <h1 className="text-4xl font-black tracking-tight">Simple pricing</h1>
        <p className="mx-auto mt-4 max-w-xl text-slate-400">
          Every feature is free while ExpansionWhitespaceMapper is in early access. No seat limits, no usage caps.
        </p>

        <div className="mt-12 rounded-2xl border border-brand-500/30 bg-gradient-to-br from-brand-600/10 to-brand-600/10 p-8 text-left">
          <div className="flex items-baseline justify-between">
            <div>
              <h2 className="text-xl font-bold">Free</h2>
              <p className="mt-1 text-sm text-slate-400">The complete platform, no charge.</p>
            </div>
            <div className="text-right">
              <div className="text-4xl font-black">$0</div>
              <div className="text-xs text-slate-500">per month</div>
            </div>
          </div>

          <ul className="mt-8 space-y-3">
            {INCLUDED.map((item) => (
              <li key={item} className="flex items-start gap-3 text-sm text-slate-200">
                <svg
                  className="mt-0.5 h-4 w-4 shrink-0 text-brand-400"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                {item}
              </li>
            ))}
          </ul>

          <Link
            href="/auth/sign-up"
            className="mt-8 block rounded-lg bg-brand-600 px-6 py-3 text-center text-sm font-semibold text-white hover:bg-brand-500"
          >
            Get started for free
          </Link>

          <p className="mt-4 text-center text-xs text-slate-500">
            {stripeEnabled === true
              ? 'Paid plans are available — manage billing from Settings once signed in.'
              : 'Billing is optional and not currently required. Upgrade paths appear here if enabled.'}
          </p>
        </div>
      </section>

      <footer className="border-t border-slate-800 py-10 text-center text-sm text-slate-600">
        <p>ExpansionWhitespaceMapper</p>
      </footer>
    </main>
  )
}
