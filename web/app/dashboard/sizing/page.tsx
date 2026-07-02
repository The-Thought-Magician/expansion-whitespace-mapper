'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface SizingRow {
  id: string
  account_id?: string
  account_name?: string
  product_id?: string
  product_name?: string
  open_arr_cents?: number
  method?: string
  confidence?: number | string | null
  low_arr_cents?: number
  high_arr_cents?: number
  computed_at?: string
}

interface RollupBucket {
  key?: string
  name?: string
  label?: string
  open_arr_cents?: number
  count?: number
}

interface Rollups {
  total?: number | { open_arr_cents?: number; count?: number }
  byAccount?: RollupBucket[]
  byCsm?: RollupBucket[]
  bySegment?: RollupBucket[]
}

const METHODS = [
  { value: 'list_price', label: 'Price book' },
  { value: 'current_arr_uplift', label: 'Peer median' },
  { value: 'per_seat', label: 'Seat-based' },
  { value: 'default_expansion', label: 'Flat default' },
]

function fmtUsd(cents?: number | null): string {
  const n = (cents ?? 0) / 100
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}

function fmtUsdFull(cents?: number | null): string {
  return `$${((cents ?? 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function bucketArr(b: RollupBucket): number {
  return b.open_arr_cents ?? 0
}

function bucketLabel(b: RollupBucket): string {
  return b.name ?? b.label ?? b.key ?? '—'
}

function confidenceTone(c: number | string | null | undefined): 'green' | 'amber' | 'red' | 'slate' {
  const n = typeof c === 'string' ? parseFloat(c) : c
  if (n == null || Number.isNaN(n)) return 'slate'
  if (n >= 0.75) return 'green'
  if (n >= 0.5) return 'amber'
  return 'red'
}

function BarList({ items }: { items: RollupBucket[] }) {
  const top = [...items].sort((a, b) => bucketArr(b) - bucketArr(a)).slice(0, 10)
  const max = Math.max(1, ...top.map(bucketArr))
  if (top.length === 0) return <p className="px-5 py-6 text-sm text-slate-500">No data.</p>
  return (
    <div className="space-y-2.5 px-5 py-4">
      {top.map((b, i) => (
        <div key={i}>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="truncate pr-2 text-slate-300">{bucketLabel(b)}</span>
            <span className="tabular-nums text-slate-400">{fmtUsd(bucketArr(b))}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-500"
              style={{ width: `${(bucketArr(b) / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function SizingPage() {
  const [rows, setRows] = useState<SizingRow[]>([])
  const [rollups, setRollups] = useState<Rollups | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [methodFilter, setMethodFilter] = useState('')
  const [recomputeMethod, setRecomputeMethod] = useState('list_price')
  const [computing, setComputing] = useState(false)
  const [computeMsg, setComputeMsg] = useState('')
  const [sortBy, setSortBy] = useState<'arr' | 'confidence'>('arr')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const [s, r] = await Promise.all([api.listSizing(), api.getSizingRollups()])
      setRows(Array.isArray(s) ? s : [])
      setRollups(r ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load sizing data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const totalArr = useMemo(() => {
    if (!rollups) return 0
    if (typeof rollups.total === 'number') return rollups.total
    if (rollups.total && typeof rollups.total === 'object') return rollups.total.open_arr_cents ?? 0
    return rows.reduce((acc, r) => acc + (r.open_arr_cents ?? 0), 0)
  }, [rollups, rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = rows.filter((r) => {
      if (methodFilter && r.method !== methodFilter) return false
      if (!q) return true
      return (
        (r.account_name ?? '').toLowerCase().includes(q) ||
        (r.product_name ?? '').toLowerCase().includes(q)
      )
    })
    list = [...list].sort((a, b) => {
      if (sortBy === 'arr') return (b.open_arr_cents ?? 0) - (a.open_arr_cents ?? 0)
      const ca = typeof a.confidence === 'string' ? parseFloat(a.confidence) : a.confidence ?? 0
      const cb = typeof b.confidence === 'string' ? parseFloat(b.confidence) : b.confidence ?? 0
      return (cb || 0) - (ca || 0)
    })
    return list
  }, [rows, search, methodFilter, sortBy])

  const methodBreakdown = useMemo(() => {
    const m = new Map<string, { count: number; arr: number }>()
    for (const r of rows) {
      const key = r.method ?? 'unknown'
      const cur = m.get(key) ?? { count: 0, arr: 0 }
      cur.count += 1
      cur.arr += r.open_arr_cents ?? 0
      m.set(key, cur)
    }
    return Array.from(m.entries()).map(([method, v]) => ({ method, ...v }))
  }, [rows])

  async function recompute() {
    setComputeMsg('')
    setComputing(true)
    try {
      const res = await api.computeSizing({ method: recomputeMethod })
      const sized = res?.sized ?? 0
      const tot = res?.total_open_arr_cents
      setComputeMsg(
        `Sized ${sized} cell${sized === 1 ? '' : 's'}${
          tot != null ? ` — ${fmtUsdFull(tot)} open ARR` : ''
        }.`,
      )
      await load()
    } catch (e) {
      setComputeMsg(e instanceof Error ? e.message : 'Recompute failed')
    } finally {
      setComputing(false)
    }
  }

  if (loading) return <PageSpinner label="Loading whitespace sizing..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Whitespace Sizing</h1>
          <p className="mt-1 text-sm text-slate-400">
            Open expansion ARR sized for every eligible-not-owned cell, with rollups by account, CSM, and segment.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={recomputeMethod}
            onChange={(e) => setRecomputeMethod(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none"
          >
            {METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <Button onClick={recompute} disabled={computing}>
            {computing ? 'Sizing...' : 'Recompute sizing'}
          </Button>
        </div>
      </div>

      {computeMsg && (
        <div className="rounded-lg border border-brand-500/30 bg-brand-500/10 px-4 py-3 text-sm text-brand-200">
          {computeMsg}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-700 bg-red-900/30 px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Total open ARR" value={fmtUsd(totalArr)} tone="purple" hint={fmtUsdFull(totalArr)} />
        <Stat label="Sized cells" value={rows.length} />
        <Stat
          label="Accounts with whitespace"
          value={rollups?.byAccount?.length ?? new Set(rows.map((r) => r.account_id)).size}
          tone="green"
        />
        <Stat label="Avg cell ARR" value={fmtUsd(rows.length ? totalArr / rows.length : 0)} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-white">By account</h2>
          </CardHeader>
          <CardBody className="p-0">
            <BarList items={rollups?.byAccount ?? []} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-white">By CSM</h2>
          </CardHeader>
          <CardBody className="p-0">
            <BarList items={rollups?.byCsm ?? []} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-white">By segment</h2>
          </CardHeader>
          <CardBody className="p-0">
            <BarList items={rollups?.bySegment ?? []} />
          </CardBody>
        </Card>
      </div>

      {methodBreakdown.length > 0 && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-white">Sizing method mix</h2>
          </CardHeader>
          <CardBody>
            <div className="flex flex-wrap gap-3">
              {methodBreakdown.map((m) => (
                <div
                  key={m.method}
                  className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-2"
                >
                  <div className="text-xs uppercase tracking-wide text-slate-500">{m.method}</div>
                  <div className="mt-0.5 text-sm font-semibold text-white">{fmtUsd(m.arr)}</div>
                  <div className="text-xs text-slate-500">{m.count} cells</div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search account or product..."
              className="w-full max-w-xs rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-brand-500 focus:outline-none"
            />
            <select
              value={methodFilter}
              onChange={(e) => setMethodFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none"
            >
              <option value="">All methods</option>
              {METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none"
            >
              <option value="arr">Sort by ARR</option>
              <option value="confidence">Sort by confidence</option>
            </select>
          </div>
          <span className="text-xs text-slate-500">{filtered.length} cells</span>
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={rows.length === 0 ? 'No sized whitespace yet' : 'No cells match your filters'}
                description={
                  rows.length === 0
                    ? 'Pick a sizing method and recompute to estimate open expansion ARR for every eligible-not-owned cell.'
                    : 'Adjust the search or method filter.'
                }
                action={
                  rows.length === 0 ? (
                    <Button onClick={recompute} disabled={computing}>
                      {computing ? 'Sizing...' : 'Recompute sizing'}
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Account</TH>
                  <TH>Product</TH>
                  <TH className="text-right">Open ARR</TH>
                  <TH className="text-right">Range (low–high)</TH>
                  <TH>Method</TH>
                  <TH>Confidence</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((r) => {
                  const conf =
                    typeof r.confidence === 'string' ? parseFloat(r.confidence) : r.confidence
                  return (
                    <TR key={r.id}>
                      <TD className="text-slate-200">{r.account_name ?? r.account_id ?? '—'}</TD>
                      <TD className="text-slate-300">{r.product_name ?? r.product_id ?? '—'}</TD>
                      <TD className="text-right font-medium tabular-nums text-white">
                        {fmtUsdFull(r.open_arr_cents)}
                      </TD>
                      <TD className="text-right tabular-nums text-slate-400">
                        {fmtUsd(r.low_arr_cents)} – {fmtUsd(r.high_arr_cents)}
                      </TD>
                      <TD>
                        <Badge tone="slate">{r.method ?? 'unknown'}</Badge>
                      </TD>
                      <TD>
                        {conf == null || Number.isNaN(conf) ? (
                          <span className="text-xs text-slate-500">—</span>
                        ) : (
                          <Badge tone={confidenceTone(conf)}>{Math.round(conf * 100)}%</Badge>
                        )}
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
