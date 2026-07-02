'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth/client'

type NavItem = { label: string; href: string }
type NavSection = { title: string; items: NavItem[] }

const NAV: NavSection[] = [
  {
    title: 'Overview',
    items: [{ label: 'Dashboard', href: '/dashboard' }],
  },
  {
    title: 'Whitespace',
    items: [
      { label: 'Grid', href: '/dashboard/grid' },
      { label: 'Sizing', href: '/dashboard/sizing' },
      { label: 'Heatmap', href: '/dashboard/heatmap' },
      { label: 'Look-Alikes', href: '/dashboard/lookalikes' },
      { label: 'Launch Planner', href: '/dashboard/launch-planner' },
    ],
  },
  {
    title: 'Accounts & Catalog',
    items: [
      { label: 'Accounts', href: '/dashboard/accounts' },
      { label: 'Catalog', href: '/dashboard/catalog' },
      { label: 'Price Book', href: '/dashboard/price-book' },
      { label: 'Eligibility Rules', href: '/dashboard/eligibility' },
      { label: 'Segments', href: '/dashboard/segments' },
      { label: 'Seats', href: '/dashboard/seats' },
    ],
  },
  {
    title: 'Plays',
    items: [
      { label: 'Play Queue', href: '/dashboard/plays' },
      { label: 'Analytics', href: '/dashboard/analytics' },
      { label: 'Targets', href: '/dashboard/targets' },
      { label: 'Books', href: '/dashboard/books' },
    ],
  },
  {
    title: 'Reporting',
    items: [
      { label: 'Snapshots', href: '/dashboard/snapshots' },
      { label: 'QBR Exports', href: '/dashboard/qbr' },
    ],
  },
  {
    title: 'Data & Admin',
    items: [
      { label: 'Imports', href: '/dashboard/imports' },
      { label: 'Notifications', href: '/dashboard/notifications' },
      { label: 'Settings', href: '/dashboard/settings' },
    ],
  },
]

function isActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [ready, setReady] = useState(false)
  const [workspace, setWorkspace] = useState('Workspace')
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const s = await authClient.getSession()
      const user = (s as any)?.data?.user ?? (s as any)?.user
      if (!user) {
        router.push('/auth/sign-in')
        return
      }
      if (!cancelled) {
        setWorkspace(user.name || user.email || 'Workspace')
        setReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [router])

  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  const signOut = async () => {
    await authClient.signOut()
    router.push('/')
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-slate-700 border-t-brand-500" />
      </div>
    )
  }

  const sidebar = (
    <nav className="flex h-full flex-col">
      <div className="px-6 py-6">
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-600 text-sm font-black text-white shadow-[0_0_0_1px_rgba(139,92,246,0.35)]">
            E
          </span>
          <span className="text-sm font-bold tracking-tight text-white">ExpansionWhitespaceMapper</span>
        </Link>
      </div>
      <div className="flex-1 space-y-6 overflow-y-auto px-4 pb-6">
        {NAV.map((section) => (
          <div key={section.title}>
            <div className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              {section.title}
            </div>
            <div className="space-y-1">
              {section.items.map((item) => {
                const active = isActive(pathname, item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`block rounded-xl px-3.5 py-2 text-sm transition-colors ${
                      active
                        ? 'bg-brand-600/15 font-medium text-brand-200 ring-1 ring-inset ring-brand-500/30'
                        : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-100'
                    }`}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </nav>
  )

  return (
    <div className="flex min-h-screen bg-slate-950">
      <aside className="hidden w-72 shrink-0 border-r border-slate-800 bg-slate-900/40 lg:block">
        {sidebar}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-950/80" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-72 border-r border-slate-800 bg-slate-900">
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900/40 px-4 py-3 lg:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white lg:hidden"
              aria-label="Open menu"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 12h18M3 6h18M3 18h18" />
              </svg>
            </button>
            <span className="truncate text-sm font-medium text-slate-300">{workspace}</span>
          </div>
          <button
            onClick={signOut}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            Sign out
          </button>
        </header>
        <main className="flex-1 overflow-x-hidden p-4 lg:p-8">{children}</main>
      </div>
    </div>
  )
}
