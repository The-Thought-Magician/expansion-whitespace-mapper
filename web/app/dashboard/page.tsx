'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Stat } from '@/components/ui/Stat'
import { Badge } from '@/components/ui/Badge'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'

function fmtMoney(cents: number | null | undefined): string {
  const n = Number(cents ?? 0) / 100
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

function fmtMoneyFull(cents: number | null | undefined): string {
  const n = Number(cents ?? 0) / 100
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

type Overview = {
  totals?: {
    total_open_arr_cents?: number
    total_owned_arr_cents?: number
    open_cells?: number
    accounts?: number
  }
  topPlays?: Array<{
    id: string
    account_name?: string
    product_name?: string
    play_type?: string
    stage?: string
    open_arr_cents?: number
    owner?: string
  }>
  books?: Array<{
    csm_owner?: string
    open_arr_cents?: number
    play_count?: number
    account_count?: number
  }>
  counts?: Record<string, number>
}

type Rollups = {
  total?: number
  byAccount?: Array<{ account_id: string; account_name?: string; open_arr_cents: number }>
  byCsm?: Array<{ csm_owner: string; open_arr_cents: number }>
  bySegment?: Array<{ segment: string; open_arr_cents: number }>
}

const STAGE_TONE: Record<string, 'purple' | 'blue' | 'amber' | 'green' | 'red' | 'slate'> = {
  identified: 'slate',
  qualified: 'blue',
  proposed: 'purple',
  negotiation: 'amber',
  won: 'green',
  lost: 'red',
}

export default function DashboardOverviewPage() {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [rollups, setRollups] = useState<Rollups | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [seeding, setSeeding] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [ov, rl] = await Promise.all([api.getOverview(), api.getSizingRollups()])
      setOverview(ov ?? {})
      setRollups(rl ?? {})
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const seed = async () => {
    setSeeding(true)
    setError(null)
    try {
      await api.seedSampleData()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to seed sample data')
    } finally {
      setSeeding(false)
    }
  }

  if (loading) return <PageSpinner label="Loading overview..." />

  const totals = overview?.totals ?? {}
  const topPlays = overview?.topPlays ?? []
  const books = overview?.books ?? []
  const bySegment = rollups?.bySegment ?? []
  const byCsm = rollups?.byCsm ?? []

  const hasData =
    (totals.accounts ?? 0) > 0 ||
    topPlays.length > 0 ||
    books.length > 0 ||
    Number(rollups?.total ?? 0) > 0

  const totalOpen = totals.total_open_arr_cents ?? rollups?.total ?? 0
  const segmentMax = Math.max(1, ...bySegment.map((s) => Number(s.open_arr_cents) || 0))
  const csmMax = Math.max(1, ...byCsm.map((c) => Number(c.open_arr_cents) || 0))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Overview</h1>
          <p className="mt-1 text-sm text-slate-400">
            Open expansion ARR, top plays in flight, and book coverage across your install base.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => void load()}>
            Refresh
          </Button>
          <Button onClick={seed} disabled={seeding}>
            {seeding ? 'Seeding...' : 'Seed sample data'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {!hasData ? (
        <EmptyState
          title="No expansion data yet"
          description="Seed a sample dataset of accounts, catalog, ownership, and eligibility rules to explore the whitespace mapper, or import your own data."
          icon={<span>◳</span>}
          action={
            <div className="flex gap-3">
              <Button onClick={seed} disabled={seeding}>
                {seeding ? 'Seeding...' : 'Seed sample data'}
              </Button>
              <Link href="/dashboard/imports">
                <Button variant="secondary">Import data</Button>
              </Link>
            </div>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Total open ARR"
              value={fmtMoney(totalOpen)}
              hint={fmtMoneyFull(totalOpen)}
              tone="purple"
            />
            <Stat
              label="Owned ARR"
              value={fmtMoney(totals.total_owned_arr_cents)}
              hint="Current install base"
              tone="green"
            />
            <Stat
              label="Open whitespace cells"
              value={(totals.open_cells ?? overview?.counts?.open_cells ?? 0).toLocaleString()}
              hint="Eligible, not yet owned"
            />
            <Stat
              label="Accounts"
              value={(totals.accounts ?? overview?.counts?.accounts ?? 0).toLocaleString()}
              hint="In coverage"
            />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">Top plays</h2>
                <Link href="/dashboard/plays" className="text-xs text-brand-300 hover:text-brand-200">
                  View all plays
                </Link>
              </CardHeader>
              <CardBody className="p-0">
                {topPlays.length === 0 ? (
                  <div className="px-5 py-10 text-center text-sm text-slate-500">No plays yet.</div>
                ) : (
                  <Table>
                    <THead>
                      <TR>
                        <TH>Account</TH>
                        <TH>Product</TH>
                        <TH>Stage</TH>
                        <TH className="text-right">Open ARR</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {topPlays.map((p) => (
                        <TR key={p.id}>
                          <TD className="font-medium text-white">{p.account_name ?? '—'}</TD>
                          <TD className="text-slate-400">{p.product_name ?? '—'}</TD>
                          <TD>
                            <Badge tone={STAGE_TONE[(p.stage ?? '').toLowerCase()] ?? 'slate'}>
                              {p.stage ?? 'identified'}
                            </Badge>
                          </TD>
                          <TD className="text-right font-semibold text-brand-300">
                            {fmtMoney(p.open_arr_cents)}
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <h2 className="text-sm font-semibold text-white">Open ARR by segment</h2>
              </CardHeader>
              <CardBody className="space-y-3">
                {bySegment.length === 0 ? (
                  <div className="py-6 text-center text-sm text-slate-500">No segment data.</div>
                ) : (
                  bySegment.map((s) => {
                    const pct = Math.round(((Number(s.open_arr_cents) || 0) / segmentMax) * 100)
                    return (
                      <div key={s.segment}>
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="text-slate-300">{s.segment || 'Unsegmented'}</span>
                          <span className="font-medium text-slate-400">{fmtMoney(s.open_arr_cents)}</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    )
                  })
                )}
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Book summary by CSM</h2>
              <Link href="/dashboard/books" className="text-xs text-brand-300 hover:text-brand-200">
                Full books view
              </Link>
            </CardHeader>
            <CardBody className="p-0">
              {books.length === 0 ? (
                <div className="px-5 py-10 text-center text-sm text-slate-500">No book data yet.</div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>CSM</TH>
                      <TH className="text-right">Accounts</TH>
                      <TH className="text-right">Plays</TH>
                      <TH className="text-right">Open ARR</TH>
                      <TH>Coverage</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {books.map((b, i) => {
                      const arr = Number(b.open_arr_cents) || 0
                      const pct = Math.round((arr / csmMax) * 100)
                      return (
                        <TR key={`${b.csm_owner ?? 'unassigned'}-${i}`}>
                          <TD className="font-medium text-white">{b.csm_owner || 'Unassigned'}</TD>
                          <TD className="text-right text-slate-300">{b.account_count ?? 0}</TD>
                          <TD className="text-right text-slate-300">{b.play_count ?? 0}</TD>
                          <TD className="text-right font-semibold text-brand-300">{fmtMoney(arr)}</TD>
                          <TD>
                            <div className="h-2 w-28 overflow-hidden rounded-full bg-slate-800">
                              <div
                                className="h-full rounded-full bg-brand-500"
                                style={{ width: `${pct}%` }}
                              />
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
