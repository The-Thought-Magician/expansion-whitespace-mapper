'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'

function fmtMoney(cents: number | null | undefined): string {
  const n = Number(cents ?? 0) / 100
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

type Account = { id: string; name: string; segment?: string | null; csm_owner?: string | null }
type Product = { id: string; name: string; sku_code?: string | null; family?: string | null }
type Cell = {
  account_id: string
  product_id: string
  state: string // owned | eligible | ineligible | unknown
  open_arr_cents?: number | null
  reason?: string | null
}
type Grid = { accounts: Account[]; products: Product[]; cells: Cell[] }

type CellDetail = {
  state?: string
  reason?: string | null
  sized?: { open_arr_cents?: number; method?: string; confidence?: number; low_arr_cents?: number; high_arr_cents?: number } | null
}

type SavedView = { id: string; name: string; surface: string; filters: Record<string, unknown>; is_shared?: boolean }

const STATE_STYLE: Record<string, { bg: string; label: string; tone: 'green' | 'purple' | 'slate' | 'red' }> = {
  owned: { bg: 'bg-emerald-500/25 hover:bg-emerald-500/40 text-emerald-200', label: 'Owned', tone: 'green' },
  eligible: { bg: 'bg-brand-500/25 hover:bg-brand-500/45 text-brand-200', label: 'Whitespace', tone: 'purple' },
  ineligible: { bg: 'bg-slate-800/60 hover:bg-slate-800 text-slate-500', label: 'Ineligible', tone: 'slate' },
  unknown: { bg: 'bg-slate-900 hover:bg-slate-800 text-slate-600', label: 'Unknown', tone: 'slate' },
}

export default function GridPage() {
  const [grid, setGrid] = useState<Grid | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // filters
  const [segment, setSegment] = useState('')
  const [csm, setCsm] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [search, setSearch] = useState('')

  // saved views
  const [views, setViews] = useState<SavedView[]>([])
  const [saveOpen, setSaveOpen] = useState(false)
  const [viewName, setViewName] = useState('')
  const [savingView, setSavingView] = useState(false)

  // cell drill
  const [drill, setDrill] = useState<{ account: Account; product: Product } | null>(null)
  const [drillDetail, setDrillDetail] = useState<CellDetail | null>(null)
  const [drillLoading, setDrillLoading] = useState(false)

  // bulk play create
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkType, setBulkType] = useState('cross_sell')
  const [bulkOwner, setBulkOwner] = useState('')
  const [bulkMinArr, setBulkMinArr] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkResult, setBulkResult] = useState<string | null>(null)

  const loadGrid = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params: Record<string, string> = {}
      if (segment) params.segment = segment
      if (csm) params.csm_owner = csm
      const g = await api.getGrid(Object.keys(params).length ? params : undefined)
      setGrid({
        accounts: g?.accounts ?? [],
        products: g?.products ?? [],
        cells: g?.cells ?? [],
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load grid')
    } finally {
      setLoading(false)
    }
  }, [segment, csm])

  const loadViews = useCallback(async () => {
    try {
      const v = await api.listSavedViews({ surface: 'grid' })
      setViews(Array.isArray(v) ? v : [])
    } catch {
      setViews([])
    }
  }, [])

  useEffect(() => {
    void loadGrid()
  }, [loadGrid])

  useEffect(() => {
    void loadViews()
  }, [loadViews])

  const cellMap = useMemo(() => {
    const m = new Map<string, Cell>()
    for (const c of grid?.cells ?? []) m.set(`${c.account_id}:${c.product_id}`, c)
    return m
  }, [grid])

  const segments = useMemo(
    () => [...new Set((grid?.accounts ?? []).map((a) => a.segment).filter(Boolean) as string[])].sort(),
    [grid],
  )
  const csms = useMemo(
    () => [...new Set((grid?.accounts ?? []).map((a) => a.csm_owner).filter(Boolean) as string[])].sort(),
    [grid],
  )

  const visibleAccounts = useMemo(() => {
    let accs = grid?.accounts ?? []
    if (search.trim()) {
      const q = search.toLowerCase()
      accs = accs.filter((a) => a.name.toLowerCase().includes(q))
    }
    if (stateFilter) {
      const prodIds = (grid?.products ?? []).map((p) => p.id)
      accs = accs.filter((a) => prodIds.some((pid) => cellMap.get(`${a.id}:${pid}`)?.state === stateFilter))
    }
    return accs
  }, [grid, search, stateFilter, cellMap])

  const openWhitespaceTotal = useMemo(
    () =>
      (grid?.cells ?? [])
        .filter((c) => c.state === 'eligible')
        .reduce((s, c) => s + (Number(c.open_arr_cents) || 0), 0),
    [grid],
  )

  const openCellCount = useMemo(
    () => (grid?.cells ?? []).filter((c) => c.state === 'eligible').length,
    [grid],
  )

  const openDrill = async (account: Account, product: Product) => {
    setDrill({ account, product })
    setDrillDetail(null)
    setDrillLoading(true)
    try {
      const d = await api.getGridCell(account.id, product.id)
      setDrillDetail(d ?? {})
    } catch (e) {
      setDrillDetail({ reason: e instanceof Error ? e.message : 'Failed to load cell' })
    } finally {
      setDrillLoading(false)
    }
  }

  const saveView = async () => {
    if (!viewName.trim()) return
    setSavingView(true)
    try {
      await api.createSavedView({
        name: viewName.trim(),
        surface: 'grid',
        filters: { segment, csm_owner: csm, state: stateFilter, search },
        is_shared: false,
      })
      setViewName('')
      setSaveOpen(false)
      await loadViews()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save view')
    } finally {
      setSavingView(false)
    }
  }

  const applyView = (v: SavedView) => {
    const f = (v.filters ?? {}) as Record<string, string>
    setSegment(f.segment ?? '')
    setCsm(f.csm_owner ?? '')
    setStateFilter(f.state ?? '')
    setSearch(f.search ?? '')
  }

  const runBulk = async () => {
    setBulkBusy(true)
    setBulkResult(null)
    setError(null)
    try {
      const body: Record<string, unknown> = { play_type: bulkType }
      if (bulkOwner.trim()) body.owner = bulkOwner.trim()
      if (segment) body.segment = segment
      if (csm) body.csm_owner = csm
      if (bulkMinArr.trim()) body.min_open_arr_cents = Math.round(Number(bulkMinArr) * 100)
      const res = await api.bulkPlaysFromWhitespace(body)
      const created = (res && (res.created ?? res.count)) ?? 0
      setBulkResult(`Created ${created} play${created === 1 ? '' : 's'} from open whitespace.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create plays')
    } finally {
      setBulkBusy(false)
    }
  }

  const clearFilters = () => {
    setSegment('')
    setCsm('')
    setStateFilter('')
    setSearch('')
  }

  if (loading && !grid) return <PageSpinner label="Loading grid..." />

  const hasGrid = (grid?.accounts.length ?? 0) > 0 && (grid?.products.length ?? 0) > 0

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Whitespace Grid</h1>
          <p className="mt-1 text-sm text-slate-400">
            Owned vs eligible matrix across accounts and products. Click any cell to drill into its sizing and rule trace.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void loadGrid()}>
            Refresh
          </Button>
          <Button variant="secondary" onClick={() => setSaveOpen(true)} disabled={!hasGrid}>
            Save view
          </Button>
          <Button onClick={() => setBulkOpen(true)} disabled={!hasGrid}>
            Bulk create plays
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {!hasGrid ? (
        <EmptyState
          title="No grid to show"
          description="Add accounts and a product catalog, then apply eligibility rules to populate the owned-vs-eligible matrix."
          icon={<span>▦</span>}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3">
              <div className="text-xs uppercase tracking-wide text-slate-500">Open whitespace</div>
              <div className="mt-1 text-xl font-bold text-brand-300">{fmtMoney(openWhitespaceTotal)}</div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3">
              <div className="text-xs uppercase tracking-wide text-slate-500">Open cells</div>
              <div className="mt-1 text-xl font-bold text-white">{openCellCount.toLocaleString()}</div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3">
              <div className="text-xs uppercase tracking-wide text-slate-500">Accounts</div>
              <div className="mt-1 text-xl font-bold text-white">{grid?.accounts.length}</div>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3">
              <div className="text-xs uppercase tracking-wide text-slate-500">Products</div>
              <div className="mt-1 text-xl font-bold text-white">{grid?.products.length}</div>
            </div>
          </div>

          {views.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Saved views:</span>
              {views.map((v) => (
                <button
                  key={v.id}
                  onClick={() => applyView(v)}
                  className="rounded-full border border-slate-700 bg-slate-800/60 px-3 py-1 text-xs text-slate-300 hover:border-brand-500/40 hover:text-brand-200"
                >
                  {v.name}
                </button>
              ))}
            </div>
          )}

          <Card>
            <CardBody className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[180px]">
                <label className="mb-1 block text-xs text-slate-500">Search account</label>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Account name..."
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-600 focus:border-brand-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Segment</label>
                <select
                  value={segment}
                  onChange={(e) => setSegment(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none"
                >
                  <option value="">All</option>
                  {segments.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">CSM</label>
                <select
                  value={csm}
                  onChange={(e) => setCsm(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none"
                >
                  <option value="">All</option>
                  {csms.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Cell state</label>
                <select
                  value={stateFilter}
                  onChange={(e) => setStateFilter(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none"
                >
                  <option value="">Any</option>
                  <option value="owned">Owned</option>
                  <option value="eligible">Whitespace</option>
                  <option value="ineligible">Ineligible</option>
                </select>
              </div>
              <Button variant="ghost" onClick={clearFilters}>
                Clear
              </Button>
            </CardBody>
          </Card>

          <div className="flex flex-wrap gap-4 text-xs text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded bg-emerald-500/40" /> Owned
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded bg-brand-500/40" /> Whitespace (eligible)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded bg-slate-700" /> Ineligible
            </span>
          </div>

          {loading ? (
            <Spinner label="Refreshing..." className="py-10" />
          ) : visibleAccounts.length === 0 ? (
            <EmptyState title="No matching accounts" description="Adjust your filters to see grid cells." />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-900/80">
                    <th className="sticky left-0 z-10 bg-slate-900/95 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Account
                    </th>
                    {grid?.products.map((p) => (
                      <th
                        key={p.id}
                        className="px-2 py-3 text-center text-[11px] font-semibold text-slate-400"
                        title={p.name}
                      >
                        <div className="max-w-[90px] truncate">{p.name}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {visibleAccounts.map((a) => (
                    <tr key={a.id} className="hover:bg-slate-900/30">
                      <td className="sticky left-0 z-10 bg-slate-950/95 px-4 py-2">
                        <div className="font-medium text-white">{a.name}</div>
                        <div className="text-[11px] text-slate-500">
                          {a.segment ?? '—'}
                          {a.csm_owner ? ` · ${a.csm_owner}` : ''}
                        </div>
                      </td>
                      {grid?.products.map((p) => {
                        const c = cellMap.get(`${a.id}:${p.id}`)
                        const st = STATE_STYLE[c?.state ?? 'unknown'] ?? STATE_STYLE.unknown
                        return (
                          <td key={p.id} className="px-1 py-1 text-center">
                            <button
                              onClick={() => openDrill(a, p)}
                              className={`flex h-11 w-full min-w-[72px] flex-col items-center justify-center rounded-md text-[11px] font-medium transition-colors ${st.bg}`}
                              title={`${a.name} · ${p.name} — ${st.label}`}
                            >
                              {c?.state === 'eligible' && (Number(c.open_arr_cents) || 0) > 0 ? (
                                <span>{fmtMoney(c.open_arr_cents)}</span>
                              ) : c?.state === 'owned' ? (
                                <span>✓</span>
                              ) : (
                                <span className="opacity-50">·</span>
                              )}
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Cell drill modal */}
      <Modal
        open={!!drill}
        onClose={() => setDrill(null)}
        title={drill ? `${drill.account.name} · ${drill.product.name}` : ''}
        footer={
          <Button variant="secondary" onClick={() => setDrill(null)}>
            Close
          </Button>
        }
      >
        {drillLoading ? (
          <Spinner label="Loading cell..." className="py-6" />
        ) : (
          <div className="space-y-4 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-slate-500">State:</span>
              <Badge tone={STATE_STYLE[drillDetail?.state ?? 'unknown']?.tone ?? 'slate'}>
                {STATE_STYLE[drillDetail?.state ?? 'unknown']?.label ?? drillDetail?.state ?? 'Unknown'}
              </Badge>
            </div>
            {drillDetail?.reason && (
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">Rule trace</div>
                <p className="mt-1 text-slate-300">{drillDetail.reason}</p>
              </div>
            )}
            {drillDetail?.sized && (
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                <div className="text-xs uppercase tracking-wide text-slate-500">Sizing</div>
                <div className="mt-1 text-2xl font-bold text-brand-300">
                  {fmtMoney(drillDetail.sized.open_arr_cents)}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                  {drillDetail.sized.method && <span>Method: {drillDetail.sized.method}</span>}
                  {drillDetail.sized.confidence != null && (
                    <span>Confidence: {Math.round(Number(drillDetail.sized.confidence) * 100)}%</span>
                  )}
                  {drillDetail.sized.low_arr_cents != null && drillDetail.sized.high_arr_cents != null && (
                    <span>
                      Range: {fmtMoney(drillDetail.sized.low_arr_cents)} – {fmtMoney(drillDetail.sized.high_arr_cents)}
                    </span>
                  )}
                </div>
              </div>
            )}
            {!drillDetail?.reason && !drillDetail?.sized && (
              <p className="text-slate-500">No additional detail for this cell.</p>
            )}
          </div>
        )}
      </Modal>

      {/* Save view modal */}
      <Modal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        title="Save current view"
        footer={
          <>
            <Button variant="secondary" onClick={() => setSaveOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveView} disabled={savingView || !viewName.trim()}>
              {savingView ? 'Saving...' : 'Save view'}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="text-slate-400">
            Saves the active filters (segment, CSM, state, search) so you can recall this slice later.
          </p>
          <div>
            <label className="mb-1 block text-xs text-slate-500">View name</label>
            <input
              value={viewName}
              onChange={(e) => setViewName(e.target.value)}
              placeholder="e.g. Enterprise cross-sell"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-600 focus:border-brand-500 focus:outline-none"
            />
          </div>
        </div>
      </Modal>

      {/* Bulk play modal */}
      <Modal
        open={bulkOpen}
        onClose={() => {
          setBulkOpen(false)
          setBulkResult(null)
        }}
        title="Bulk create plays from whitespace"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setBulkOpen(false)
                setBulkResult(null)
              }}
            >
              Close
            </Button>
            <Button onClick={runBulk} disabled={bulkBusy}>
              {bulkBusy ? 'Creating...' : 'Create plays'}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="text-slate-400">
            Generates plays for every open whitespace cell matching the current segment/CSM filters and the criteria below.
          </p>
          <div>
            <label className="mb-1 block text-xs text-slate-500">Play type</label>
            <select
              value={bulkType}
              onChange={(e) => setBulkType(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none"
            >
              <option value="cross_sell">Cross-sell</option>
              <option value="upsell">Upsell</option>
              <option value="seat_expansion">Seat expansion</option>
              <option value="module_attach">Module attach</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-slate-500">Owner (optional)</label>
              <input
                value={bulkOwner}
                onChange={(e) => setBulkOwner(e.target.value)}
                placeholder="CSM name"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-600 focus:border-brand-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">Min open ARR ($)</label>
              <input
                type="number"
                value={bulkMinArr}
                onChange={(e) => setBulkMinArr(e.target.value)}
                placeholder="0"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-600 focus:border-brand-500 focus:outline-none"
              />
            </div>
          </div>
          {(segment || csm) && (
            <div className="text-xs text-slate-500">
              Scoped to{segment ? ` segment "${segment}"` : ''}
              {segment && csm ? ' and' : ''}
              {csm ? ` CSM "${csm}"` : ''}.
            </div>
          )}
          {bulkResult && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-emerald-300">
              {bulkResult}
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}
