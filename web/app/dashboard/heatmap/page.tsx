'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { Stat } from '@/components/ui/Stat'
import { Spinner, PageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

type HeatProduct = { id: string; name?: string; sku_code?: string; family?: string | null }
type HeatCell = {
  segment: string
  product_id: string
  adoption?: number | null
  owned?: number | null
  eligible?: number | null
  total?: number | null
}
type HeatmapResponse = {
  segments: string[]
  products: HeatProduct[]
  cells: HeatCell[]
}

type CellAccount = {
  id: string
  name: string
  segment?: string | null
  csm_owner?: string | null
  region?: string | null
  industry?: string | null
  current_arr_cents?: number | null
}

function fmtPct(v?: number | null): string {
  if (v == null || Number.isNaN(v)) return '—'
  // adoption may arrive as 0..1 or 0..100; normalize to a percentage 0..100
  const pct = v <= 1 ? v * 100 : v
  return `${Math.round(pct)}%`
}

function adoptionRatio(v?: number | null): number {
  if (v == null || Number.isNaN(v)) return 0
  const pct = v <= 1 ? v : v / 100
  return Math.max(0, Math.min(1, pct))
}

// Map an adoption ratio to a slate/purple heat color.
function heatStyle(ratio: number): React.CSSProperties {
  const alpha = 0.08 + ratio * 0.82
  return {
    backgroundColor: `rgba(168, 85, 247, ${alpha.toFixed(3)})`,
    color: ratio > 0.55 ? '#f5f3ff' : '#cbd5e1',
  }
}

function fmtArr(cents?: number | null): string {
  if (cents == null) return '—'
  const dollars = cents / 100
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(0)}K`
  return `$${dollars.toFixed(0)}`
}

export default function HeatmapPage() {
  const [data, setData] = useState<HeatmapResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [familyFilter, setFamilyFilter] = useState<string>('all')
  const [search, setSearch] = useState('')

  // Drill-down cell state
  const [drill, setDrill] = useState<{ segment: string; product: HeatProduct } | null>(null)
  const [drillAccounts, setDrillAccounts] = useState<CellAccount[] | null>(null)
  const [drillLoading, setDrillLoading] = useState(false)
  const [drillError, setDrillError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = (await api.getHeatmap()) as HeatmapResponse
      setData({
        segments: res?.segments ?? [],
        products: res?.products ?? [],
        cells: res?.cells ?? [],
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load heatmap')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const cellIndex = useMemo(() => {
    const m = new Map<string, HeatCell>()
    for (const c of data?.cells ?? []) m.set(`${c.segment}|||${c.product_id}`, c)
    return m
  }, [data])

  const families = useMemo(() => {
    const set = new Set<string>()
    for (const p of data?.products ?? []) if (p.family) set.add(p.family)
    return Array.from(set).sort()
  }, [data])

  const products = useMemo(() => {
    let list = data?.products ?? []
    if (familyFilter !== 'all') list = list.filter((p) => p.family === familyFilter)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(
        (p) =>
          (p.name ?? '').toLowerCase().includes(q) ||
          (p.sku_code ?? '').toLowerCase().includes(q),
      )
    }
    return list
  }, [data, familyFilter, search])

  const segments = data?.segments ?? []

  const summary = useMemo(() => {
    const cells = data?.cells ?? []
    const known = cells.filter((c) => c.adoption != null)
    const avg = known.length
      ? known.reduce((s, c) => s + adoptionRatio(c.adoption), 0) / known.length
      : 0
    const cold = cells.filter((c) => adoptionRatio(c.adoption) < 0.2).length
    return {
      avg: avg * 100,
      cells: cells.length,
      cold,
      segments: segments.length,
      products: data?.products.length ?? 0,
    }
  }, [data, segments.length])

  async function openCell(segment: string, product: HeatProduct) {
    setDrill({ segment, product })
    setDrillAccounts(null)
    setDrillError(null)
    setDrillLoading(true)
    try {
      const accounts = (await api.getHeatmapCell(segment, product.id)) as CellAccount[]
      setDrillAccounts(Array.isArray(accounts) ? accounts : [])
    } catch (e) {
      setDrillError(e instanceof Error ? e.message : 'Failed to load cell accounts')
    } finally {
      setDrillLoading(false)
    }
  }

  if (loading) return <PageSpinner label="Loading penetration heatmap..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Penetration Heatmap</h1>
          <p className="mt-1 text-sm text-slate-400">
            Product adoption across segments. Darker cells mean higher penetration; cold cells are
            expansion whitespace.
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
            <Stat label="Avg Adoption" value={`${Math.round(summary.avg)}%`} tone="purple" />
            <Stat label="Segments" value={summary.segments} />
            <Stat label="Products" value={summary.products} />
            <Stat
              label="Cold Cells"
              value={summary.cold}
              tone="amber"
              hint="< 20% penetration"
            />
          </div>

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-white">Segment × Product</h2>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search products..."
                    className="w-44 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-purple-500 focus:outline-none"
                  />
                  <select
                    value={familyFilter}
                    onChange={(e) => setFamilyFilter(e.target.value)}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 focus:border-purple-500 focus:outline-none"
                  >
                    <option value="all">All families</option>
                    {families.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </CardHeader>
            <CardBody>
              {segments.length === 0 || products.length === 0 ? (
                <EmptyState
                  title="No heatmap data"
                  description="Once accounts, products, ownership and segments exist, penetration will appear here. Seed sample data from the dashboard to explore."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-separate border-spacing-1 text-sm">
                    <thead>
                      <tr>
                        <th className="sticky left-0 z-10 bg-slate-900 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                          Segment
                        </th>
                        {products.map((p) => (
                          <th
                            key={p.id}
                            className="px-2 py-2 text-center text-xs font-semibold text-slate-400"
                            title={p.name ?? p.sku_code}
                          >
                            <div className="mx-auto max-w-[88px] truncate">
                              {p.name ?? p.sku_code ?? p.id}
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {segments.map((seg) => (
                        <tr key={seg}>
                          <td className="sticky left-0 z-10 bg-slate-900 px-3 py-2 text-left text-sm font-medium text-slate-200">
                            {seg}
                          </td>
                          {products.map((p) => {
                            const cell = cellIndex.get(`${seg}|||${p.id}`)
                            const ratio = adoptionRatio(cell?.adoption)
                            return (
                              <td key={p.id} className="p-0">
                                <button
                                  onClick={() => openCell(seg, p)}
                                  style={heatStyle(ratio)}
                                  className="flex h-12 w-full min-w-[64px] flex-col items-center justify-center rounded-md border border-slate-800/60 px-2 transition hover:ring-2 hover:ring-purple-400/70"
                                  title={`${seg} · ${p.name ?? p.sku_code}: ${fmtPct(cell?.adoption)} (${cell?.owned ?? 0}/${cell?.total ?? 0})`}
                                >
                                  <span className="text-xs font-semibold">
                                    {fmtPct(cell?.adoption)}
                                  </span>
                                  {cell?.total != null && (
                                    <span className="text-[10px] opacity-70">
                                      {cell.owned ?? 0}/{cell.total}
                                    </span>
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
            </CardBody>
          </Card>

          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span>Low</span>
            <div className="flex h-3 w-40 overflow-hidden rounded-full">
              {[0, 0.25, 0.5, 0.75, 1].map((r) => (
                <div key={r} className="flex-1" style={{ backgroundColor: heatStyle(r).backgroundColor }} />
              ))}
            </div>
            <span>High</span>
            <span className="ml-2">Click a cell for eligible-not-owned accounts.</span>
          </div>
        </>
      )}

      <Modal
        open={!!drill}
        onClose={() => setDrill(null)}
        title={
          drill
            ? `${drill.segment} · ${drill.product.name ?? drill.product.sku_code ?? 'Product'}`
            : ''
        }
        className="max-w-2xl"
      >
        {drillLoading && <Spinner label="Loading accounts..." />}
        {drillError && <p className="text-sm text-red-300">{drillError}</p>}
        {!drillLoading && !drillError && drillAccounts && (
          <>
            <div className="mb-3 flex items-center gap-2 text-sm text-slate-400">
              <Badge tone="purple">{drillAccounts.length}</Badge>
              eligible-not-owned accounts (open whitespace)
            </div>
            {drillAccounts.length === 0 ? (
              <EmptyState
                title="No open accounts"
                description="Every eligible account in this segment already owns this product, or none are eligible."
              />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Account</TH>
                    <TH>CSM</TH>
                    <TH>Region</TH>
                    <TH className="text-right">Current ARR</TH>
                  </TR>
                </THead>
                <TBody>
                  {drillAccounts.map((a) => (
                    <TR key={a.id}>
                      <TD className="font-medium text-white">{a.name}</TD>
                      <TD>{a.csm_owner ?? '—'}</TD>
                      <TD>{a.region ?? '—'}</TD>
                      <TD className="text-right tabular-nums">{fmtArr(a.current_arr_cents)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </>
        )}
      </Modal>
    </div>
  )
}
