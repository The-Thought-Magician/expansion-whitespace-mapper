'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { Stat } from '@/components/ui/Stat'
import { PageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

type BookRow = {
  csm_owner?: string | null
  csm?: string | null
  open_arr_cents?: number | null
  owned_arr_cents?: number | null
  accounts?: number | null
  account_count?: number | null
  plays?: number | null
  play_count?: number | null
  penetration?: number | null
  coverage_gaps?: number | null
  gaps?: number | null
}

type LeaderRow = {
  csm_owner?: string | null
  csm?: string | null
  open_arr_cents?: number | null
  converted_arr_cents?: number | null
  rank?: number | null
}

function fmtArr(cents?: number | null): string {
  if (cents == null) return '—'
  const dollars = cents / 100
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(2)}M`
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(1)}K`
  return `$${dollars.toFixed(0)}`
}

function fmtPct(v?: number | null): string {
  if (v == null || Number.isNaN(v)) return '—'
  const pct = v <= 1 ? v * 100 : v
  return `${Math.round(pct)}%`
}

function pctRatio(v?: number | null): number {
  if (v == null || Number.isNaN(v)) return 0
  const r = v <= 1 ? v : v / 100
  return Math.max(0, Math.min(1, r))
}

function csmName(r: { csm_owner?: string | null; csm?: string | null }): string {
  return r.csm_owner ?? r.csm ?? 'Unassigned'
}

type SortKey = 'open' | 'accounts' | 'plays' | 'penetration'

export default function BooksPage() {
  const [books, setBooks] = useState<BookRow[] | null>(null)
  const [leaderboard, setLeaderboard] = useState<LeaderRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('open')

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [b, l] = await Promise.all([api.listBooks(), api.getBookLeaderboard()])
      setBooks(Array.isArray(b) ? (b as BookRow[]) : [])
      setLeaderboard(Array.isArray(l) ? (l as LeaderRow[]) : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load books')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const accountsOf = (r: BookRow) => r.accounts ?? r.account_count ?? 0
  const playsOf = (r: BookRow) => r.plays ?? r.play_count ?? 0
  const gapsOf = (r: BookRow) => r.coverage_gaps ?? r.gaps ?? 0

  const rows = useMemo(() => {
    let list = books ?? []
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter((r) => csmName(r).toLowerCase().includes(q))
    }
    const sorted = [...list].sort((a, b) => {
      switch (sortKey) {
        case 'accounts':
          return accountsOf(b) - accountsOf(a)
        case 'plays':
          return playsOf(b) - playsOf(a)
        case 'penetration':
          return pctRatio(b.penetration) - pctRatio(a.penetration)
        default:
          return (b.open_arr_cents ?? 0) - (a.open_arr_cents ?? 0)
      }
    })
    return sorted
  }, [books, search, sortKey])

  const totals = useMemo(() => {
    const list = books ?? []
    return {
      open: list.reduce((s, r) => s + (r.open_arr_cents ?? 0), 0),
      owned: list.reduce((s, r) => s + (r.owned_arr_cents ?? 0), 0),
      csms: list.length,
      plays: list.reduce((s, r) => s + playsOf(r), 0),
      gaps: list.reduce((s, r) => s + gapsOf(r), 0),
    }
  }, [books])

  const maxLeaderOpen = useMemo(
    () => Math.max(1, ...(leaderboard ?? []).map((r) => r.open_arr_cents ?? 0)),
    [leaderboard],
  )

  if (loading) return <PageSpinner label="Loading CSM books..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">CSM Books</h1>
          <p className="mt-1 text-sm text-slate-400">
            Whitespace coverage by book of business, with an open + converted ARR leaderboard.
          </p>
        </div>
        <Button variant="secondary" onClick={load}>
          Refresh
        </Button>
      </div>

      {error && (
        <Card>
          <CardBody>
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-red-300">{error}</p>
              <Button variant="secondary" size="sm" onClick={load}>
                Retry
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {!error && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Total Open ARR" value={fmtArr(totals.open)} tone="purple" />
            <Stat label="CSMs" value={totals.csms} />
            <Stat label="Open Plays" value={totals.plays} />
            <Stat label="Coverage Gaps" value={totals.gaps} tone="amber" />
          </div>

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-white">Leaderboard</h2>
                <span className="text-xs text-slate-500">Ranked by open whitespace ARR</span>
              </div>
            </CardHeader>
            <CardBody>
              {!leaderboard || leaderboard.length === 0 ? (
                <EmptyState
                  title="No leaderboard yet"
                  description="Assign CSM owners to accounts and size whitespace to populate the leaderboard."
                />
              ) : (
                <ol className="space-y-3">
                  {leaderboard.map((r, i) => {
                    const ratio = (r.open_arr_cents ?? 0) / maxLeaderOpen
                    return (
                      <li key={`${csmName(r)}-${i}`} className="flex items-center gap-3">
                        <span
                          className={`flex h-7 w-7 flex-none items-center justify-center rounded-full text-xs font-bold ${
                            i === 0
                              ? 'bg-purple-500/25 text-purple-200'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {r.rank ?? i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-medium text-slate-200">
                              {csmName(r)}
                            </span>
                            <span className="flex-none text-sm tabular-nums text-slate-300">
                              {fmtArr(r.open_arr_cents)}
                              {r.converted_arr_cents != null && (
                                <span className="ml-2 text-xs text-emerald-300">
                                  +{fmtArr(r.converted_arr_cents)} won
                                </span>
                              )}
                            </span>
                          </div>
                          <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-800">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-purple-600 to-purple-400"
                              style={{ width: `${Math.max(2, ratio * 100).toFixed(1)}%` }}
                            />
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ol>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-white">Book Whitespace</h2>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search CSM..."
                    className="w-44 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-purple-500 focus:outline-none"
                  />
                  <select
                    value={sortKey}
                    onChange={(e) => setSortKey(e.target.value as SortKey)}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 focus:border-purple-500 focus:outline-none"
                  >
                    <option value="open">Sort: Open ARR</option>
                    <option value="accounts">Sort: Accounts</option>
                    <option value="plays">Sort: Plays</option>
                    <option value="penetration">Sort: Penetration</option>
                  </select>
                </div>
              </div>
            </CardHeader>
            <CardBody>
              {rows.length === 0 ? (
                <EmptyState
                  title="No books found"
                  description={
                    search
                      ? 'No CSM matches your search.'
                      : 'Assign CSM owners to accounts to build books of business.'
                  }
                />
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>CSM</TH>
                      <TH className="text-right">Accounts</TH>
                      <TH className="text-right">Open ARR</TH>
                      <TH className="text-right">Owned ARR</TH>
                      <TH className="text-right">Plays</TH>
                      <TH>Penetration</TH>
                      <TH className="text-right">Gaps</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {rows.map((r, i) => (
                      <TR key={`${csmName(r)}-${i}`}>
                        <TD className="font-medium text-white">{csmName(r)}</TD>
                        <TD className="text-right tabular-nums">{accountsOf(r)}</TD>
                        <TD className="text-right tabular-nums text-purple-300">
                          {fmtArr(r.open_arr_cents)}
                        </TD>
                        <TD className="text-right tabular-nums">{fmtArr(r.owned_arr_cents)}</TD>
                        <TD className="text-right tabular-nums">{playsOf(r)}</TD>
                        <TD>
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-20 overflow-hidden rounded-full bg-slate-800">
                              <div
                                className="h-full rounded-full bg-emerald-500"
                                style={{ width: `${pctRatio(r.penetration) * 100}%` }}
                              />
                            </div>
                            <span className="text-xs tabular-nums text-slate-400">
                              {fmtPct(r.penetration)}
                            </span>
                          </div>
                        </TD>
                        <TD className="text-right">
                          {gapsOf(r) > 0 ? (
                            <Badge tone="amber">{gapsOf(r)}</Badge>
                          ) : (
                            <span className="text-slate-600">0</span>
                          )}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  )
}
