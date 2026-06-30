'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface StageBucket {
  stage: string
  count: number
  open_arr_cents: number
  weighted_arr_cents?: number
}
interface OwnerBucket {
  owner: string
  count: number
  open_arr_cents: number
  weighted_arr_cents?: number
}
interface TypeBucket {
  play_type: string
  count: number
  open_arr_cents: number
}
interface PipelineTotals {
  total_plays?: number
  pipeline_arr_cents?: number
  weighted_arr_cents?: number
}
interface PipelineAnalytics {
  byStage?: StageBucket[]
  byOwner?: OwnerBucket[]
  byType?: TypeBucket[]
  totals?: PipelineTotals
}

interface TimeInStage {
  stage: string
  avg_days?: number
  median_days?: number
  count?: number
}
interface AgingPlay {
  id: string
  account_name?: string
  account_id?: string
  product_name?: string
  product_id?: string
  stage: string
  owner?: string
  open_arr_cents?: number
  days_in_stage?: number
  age_days?: number
}
interface ConversionAnalytics {
  winRate?: number | { rate?: number; won?: number; lost?: number; total?: number }
  timeInStage?: TimeInStage[]
  aging?: AgingPlay[]
}

function fmtMoney(cents?: number | null): string {
  if (cents == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100)
}

const STAGE_TONES: Record<string, 'slate' | 'blue' | 'purple' | 'amber' | 'green' | 'red'> = {
  identified: 'slate',
  qualified: 'blue',
  engaged: 'purple',
  proposed: 'amber',
  won: 'green',
  closed_won: 'green',
  lost: 'red',
  closed_lost: 'red',
}
function stageTone(stage: string) {
  return STAGE_TONES[stage?.toLowerCase()] ?? 'slate'
}

function BarRow({ label, value, max, money, tone }: { label: string; value: number; max: number; money?: number; tone: string }) {
  const w = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0
  return (
    <div className="flex items-center gap-3">
      <div className="w-32 shrink-0 truncate text-sm text-slate-300" title={label}>{label}</div>
      <div className="flex-1">
        <div className="h-6 overflow-hidden rounded-md bg-slate-800">
          <div className={`flex h-full items-center justify-end rounded-md px-2 ${tone}`} style={{ width: `${w}%` }}>
            <span className="text-xs font-semibold text-white tabular-nums">{value}</span>
          </div>
        </div>
      </div>
      <div className="w-28 shrink-0 text-right text-xs tabular-nums text-slate-400">{money != null ? fmtMoney(money) : ''}</div>
    </div>
  )
}

export default function AnalyticsPage() {
  const [pipeline, setPipeline] = useState<PipelineAnalytics | null>(null)
  const [conversion, setConversion] = useState<ConversionAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dim, setDim] = useState<'stage' | 'owner' | 'type'>('stage')

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [p, c] = await Promise.all([api.getPipelineAnalytics(), api.getConversionAnalytics()])
      setPipeline(p ?? {})
      setConversion(c ?? {})
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load analytics')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const byStage = pipeline?.byStage ?? []
  const byOwner = pipeline?.byOwner ?? []
  const byType = pipeline?.byType ?? []
  const totals = pipeline?.totals ?? {}

  const winRatePct = useMemo(() => {
    const wr = conversion?.winRate
    if (wr == null) return null
    if (typeof wr === 'number') return wr <= 1 ? Math.round(wr * 100) : Math.round(wr)
    if (wr.rate != null) return wr.rate <= 1 ? Math.round(wr.rate * 100) : Math.round(wr.rate)
    if (wr.total) return Math.round(((wr.won ?? 0) / wr.total) * 100)
    return null
  }, [conversion])

  const winRateDetail = useMemo(() => {
    const wr = conversion?.winRate
    if (wr && typeof wr === 'object' && (wr.won != null || wr.lost != null)) {
      return `${wr.won ?? 0} won · ${wr.lost ?? 0} lost`
    }
    return undefined
  }, [conversion])

  const timeInStage = conversion?.timeInStage ?? []
  const aging = conversion?.aging ?? []

  const activeBuckets = useMemo(() => {
    if (dim === 'stage') return byStage.map((b) => ({ label: b.stage, count: b.count, arr: b.open_arr_cents }))
    if (dim === 'owner') return byOwner.map((b) => ({ label: b.owner || 'Unassigned', count: b.count, arr: b.open_arr_cents }))
    return byType.map((b) => ({ label: b.play_type, count: b.count, arr: b.open_arr_cents }))
  }, [dim, byStage, byOwner, byType])

  const maxCount = useMemo(() => Math.max(1, ...activeBuckets.map((b) => b.count)), [activeBuckets])
  const maxAging = useMemo(
    () => Math.max(1, ...aging.map((a) => a.days_in_stage ?? a.age_days ?? 0)),
    [aging],
  )

  const hasAnyData = byStage.length || byOwner.length || byType.length || (totals.total_plays ?? 0) > 0

  if (loading) return <PageSpinner label="Loading pipeline analytics…" />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Plays Pipeline Analytics</h1>
          <p className="mt-1 text-sm text-slate-400">
            Expansion pipeline coverage by stage, owner and play type, plus conversion and aging signals.
          </p>
        </div>
        <Button variant="secondary" onClick={load}>Refresh</Button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error} <button className="ml-2 underline" onClick={load}>Retry</button>
        </div>
      )}

      {!hasAnyData && !error ? (
        <EmptyState
          title="No pipeline yet"
          description="Create expansion plays from the grid, look-alikes or whitespace sizing. Analytics populate as plays accumulate."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Total plays" value={(totals.total_plays ?? byStage.reduce((a, b) => a + b.count, 0)).toLocaleString()} />
            <Stat
              label="Pipeline ARR"
              value={fmtMoney(totals.pipeline_arr_cents ?? byStage.reduce((a, b) => a + (b.open_arr_cents || 0), 0))}
              tone="purple"
            />
            <Stat label="Weighted ARR" value={fmtMoney(totals.weighted_arr_cents)} tone="green" hint="Stage-probability adjusted" />
            <Stat
              label="Win rate"
              value={winRatePct == null ? '—' : `${winRatePct}%`}
              tone={winRatePct != null && winRatePct >= 40 ? 'green' : 'amber'}
              hint={winRateDetail}
            />
          </div>

          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-white">Pipeline distribution</h2>
              <div className="flex gap-1">
                {([
                  ['stage', 'By stage'],
                  ['owner', 'By owner'],
                  ['type', 'By play type'],
                ] as const).map(([v, l]) => (
                  <button
                    key={v}
                    onClick={() => setDim(v)}
                    className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                      dim === v ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </CardHeader>
            <CardBody>
              {activeBuckets.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">No data for this dimension.</p>
              ) : (
                <div className="space-y-2.5">
                  {activeBuckets.map((b, i) => (
                    <BarRow
                      key={`${b.label}-${i}`}
                      label={b.label}
                      value={b.count}
                      max={maxCount}
                      money={b.arr}
                      tone={dim === 'stage' ? barTone(b.label) : 'bg-purple-600'}
                    />
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <h2 className="text-sm font-semibold text-white">Stage funnel</h2>
                <p className="mt-0.5 text-xs text-slate-500">Play count and open ARR per stage.</p>
              </CardHeader>
              <CardBody className="p-0">
                {byStage.length === 0 ? (
                  <p className="px-5 py-6 text-center text-sm text-slate-500">No stage data.</p>
                ) : (
                  <Table>
                    <THead>
                      <TR>
                        <TH>Stage</TH>
                        <TH className="text-right">Plays</TH>
                        <TH className="text-right">Open ARR</TH>
                        <TH className="text-right">Weighted</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {byStage.map((s) => (
                        <TR key={s.stage}>
                          <TD><Badge tone={stageTone(s.stage)}>{s.stage}</Badge></TD>
                          <TD className="text-right tabular-nums">{s.count}</TD>
                          <TD className="text-right tabular-nums text-slate-300">{fmtMoney(s.open_arr_cents)}</TD>
                          <TD className="text-right tabular-nums text-emerald-300">{fmtMoney(s.weighted_arr_cents)}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <h2 className="text-sm font-semibold text-white">Time in stage</h2>
                <p className="mt-0.5 text-xs text-slate-500">Average days plays dwell in each stage.</p>
              </CardHeader>
              <CardBody>
                {timeInStage.length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-500">No time-in-stage data yet.</p>
                ) : (
                  <div className="space-y-2.5">
                    {timeInStage.map((t) => {
                      const max = Math.max(1, ...timeInStage.map((x) => x.avg_days ?? 0))
                      const v = t.avg_days ?? 0
                      const w = Math.max(2, Math.round((v / max) * 100))
                      return (
                        <div key={t.stage} className="flex items-center gap-3">
                          <div className="w-28 shrink-0 truncate"><Badge tone={stageTone(t.stage)}>{t.stage}</Badge></div>
                          <div className="flex-1">
                            <div className="h-5 overflow-hidden rounded-md bg-slate-800">
                              <div className="h-full rounded-md bg-amber-500" style={{ width: `${w}%` }} />
                            </div>
                          </div>
                          <div className="w-24 shrink-0 text-right text-xs tabular-nums text-slate-400">
                            {v.toFixed(1)}d avg{t.count != null ? ` · ${t.count}` : ''}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-white">Aging plays</h2>
              <p className="mt-0.5 text-xs text-slate-500">Plays sitting longest in their current stage — prioritize for follow-up.</p>
            </CardHeader>
            <CardBody className="p-0">
              {aging.length === 0 ? (
                <EmptyState title="No aging plays" description="No plays are stalling in stage. Pipeline is moving." />
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Account</TH>
                      <TH>Product</TH>
                      <TH>Stage</TH>
                      <TH>Owner</TH>
                      <TH className="text-right">Open ARR</TH>
                      <TH>Days in stage</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {aging.map((a) => {
                      const days = a.days_in_stage ?? a.age_days ?? 0
                      const w = Math.round((days / maxAging) * 100)
                      return (
                        <TR key={a.id}>
                          <TD className="font-medium text-white">{a.account_name ?? a.account_id ?? '—'}</TD>
                          <TD className="text-slate-300">{a.product_name ?? a.product_id ?? '—'}</TD>
                          <TD><Badge tone={stageTone(a.stage)}>{a.stage}</Badge></TD>
                          <TD className="text-slate-400">{a.owner || 'Unassigned'}</TD>
                          <TD className="text-right tabular-nums text-slate-300">{fmtMoney(a.open_arr_cents)}</TD>
                          <TD>
                            <div className="flex items-center gap-2">
                              <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-800">
                                <div className={`h-full ${days >= 30 ? 'bg-red-500' : days >= 14 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(w, 100)}%` }} />
                              </div>
                              <span className="text-xs tabular-nums text-slate-400">{days}d</span>
                            </div>
                          </TD>
                        </TR>
                      )
                    })}
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

function barTone(stage: string): string {
  switch (stageTone(stage)) {
    case 'green': return 'bg-emerald-600'
    case 'red': return 'bg-red-600'
    case 'amber': return 'bg-amber-600'
    case 'blue': return 'bg-sky-600'
    case 'purple': return 'bg-purple-600'
    default: return 'bg-slate-600'
  }
}
