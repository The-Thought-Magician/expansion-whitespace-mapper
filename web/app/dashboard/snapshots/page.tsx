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

type Snapshot = {
  id: string
  label?: string | null
  total_open_arr_cents?: number | null
  total_owned_arr_cents?: number | null
  metrics?: Record<string, unknown> | null
  created_at?: string | null
}

type CompareResult = {
  opened?: number | null
  converted?: number | null
  churned?: number | null
  nrr_movement?: number | null
}

function fmtArr(cents?: number | null): string {
  if (cents == null) return '—'
  const dollars = cents / 100
  if (Math.abs(dollars) >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(2)}M`
  if (Math.abs(dollars) >= 1_000) return `$${(dollars / 1_000).toFixed(1)}K`
  return `$${dollars.toFixed(0)}`
}

function fmtSignedArr(cents?: number | null): string {
  if (cents == null) return '—'
  const sign = cents > 0 ? '+' : ''
  return `${sign}${fmtArr(cents)}`
}

function fmtDate(s?: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function fmtNrr(v?: number | null): string {
  if (v == null || Number.isNaN(v)) return '—'
  // accept both ratio (1.08) and pct-point movement (8 or 0.08)
  const pct = Math.abs(v) <= 1 ? v * 100 : v
  const sign = pct > 0 ? '+' : ''
  return `${sign}${pct.toFixed(1)} pts`
}

export default function SnapshotsPage() {
  const [snapshots, setSnapshots] = useState<Snapshot[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // create
  const [createOpen, setCreateOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // delete
  const [deleting, setDeleting] = useState<string | null>(null)

  // compare
  const [aId, setAId] = useState('')
  const [bId, setBId] = useState('')
  const [compare, setCompare] = useState<CompareResult | null>(null)
  const [comparing, setComparing] = useState(false)
  const [compareError, setCompareError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await api.listSnapshots()
      const list = Array.isArray(res) ? (res as Snapshot[]) : []
      setSnapshots(list)
      // default compare selection: two most recent (list assumed newest-first)
      if (list.length >= 2) {
        setBId((prev) => prev || list[0].id)
        setAId((prev) => prev || list[1].id)
      } else if (list.length === 1) {
        setBId((prev) => prev || list[0].id)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load snapshots')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function onCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    setCreateError(null)
    try {
      await api.createSnapshot({ label: label.trim() || undefined })
      setCreateOpen(false)
      setLabel('')
      await load()
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create snapshot')
    } finally {
      setCreating(false)
    }
  }

  async function onDelete(id: string) {
    if (!window.confirm('Delete this snapshot? This cannot be undone.')) return
    setDeleting(id)
    try {
      await api.deleteSnapshot(id)
      setCompare(null)
      if (aId === id) setAId('')
      if (bId === id) setBId('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete snapshot')
    } finally {
      setDeleting(null)
    }
  }

  async function onCompare(e: React.FormEvent) {
    e.preventDefault()
    if (!aId || !bId || aId === bId) {
      setCompareError('Pick two different snapshots to compare.')
      return
    }
    setComparing(true)
    setCompareError(null)
    setCompare(null)
    try {
      const res = (await api.compareSnapshots(aId, bId)) as CompareResult
      setCompare(res ?? {})
    } catch (err) {
      setCompareError(err instanceof Error ? err.message : 'Failed to compare snapshots')
    } finally {
      setComparing(false)
    }
  }

  const trend = useMemo(() => {
    // oldest -> newest for a left-to-right open-ARR trend line
    const list = [...(snapshots ?? [])].reverse()
    return list
  }, [snapshots])

  const maxTrend = useMemo(
    () => Math.max(1, ...trend.map((s) => s.total_open_arr_cents ?? 0)),
    [trend],
  )

  if (loading) return <PageSpinner label="Loading snapshots..." />

  const list = snapshots ?? []
  const labelOf = (id: string) => list.find((s) => s.id === id)?.label || id.slice(0, 8)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Snapshots</h1>
          <p className="mt-1 text-sm text-slate-400">
            Point-in-time captures of the whitespace grid and sizing. Compare two to see opened,
            converted, churned ARR and NRR movement.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={load}>
            Refresh
          </Button>
          <Button onClick={() => setCreateOpen(true)}>Create Snapshot</Button>
        </div>
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

      {list.length === 0 && !error ? (
        <EmptyState
          title="No snapshots yet"
          description="Create your first snapshot to track how whitespace ARR opens, converts, and churns over time."
          action={<Button onClick={() => setCreateOpen(true)}>Create Snapshot</Button>}
        />
      ) : (
        <>
          {/* Open ARR trend */}
          {trend.length >= 2 && (
            <Card>
              <CardHeader>
                <h2 className="text-sm font-semibold text-white">Open ARR Trend</h2>
              </CardHeader>
              <CardBody>
                <div className="flex h-40 items-end gap-2">
                  {trend.map((s) => {
                    const h = ((s.total_open_arr_cents ?? 0) / maxTrend) * 100
                    return (
                      <div key={s.id} className="flex flex-1 flex-col items-center gap-1">
                        <div className="flex w-full flex-1 items-end">
                          <div
                            className="w-full rounded-t bg-gradient-to-t from-brand-700 to-brand-400"
                            style={{ height: `${Math.max(3, h)}%` }}
                            title={`${s.label ?? s.id}: ${fmtArr(s.total_open_arr_cents)}`}
                          />
                        </div>
                        <span className="w-full truncate text-center text-[10px] text-slate-500">
                          {s.label ?? fmtDate(s.created_at)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </CardBody>
            </Card>
          )}

          {/* Compare */}
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-white">Compare Snapshots</h2>
            </CardHeader>
            <CardBody className="space-y-4">
              <form onSubmit={onCompare} className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-xs text-slate-400">
                  Baseline (A)
                  <select
                    value={aId}
                    onChange={(e) => setAId(e.target.value)}
                    className="w-56 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 focus:border-brand-500 focus:outline-none"
                  >
                    <option value="">Select baseline…</option>
                    {list.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label || s.id.slice(0, 8)} · {fmtDate(s.created_at)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-slate-400">
                  Current (B)
                  <select
                    value={bId}
                    onChange={(e) => setBId(e.target.value)}
                    className="w-56 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 focus:border-brand-500 focus:outline-none"
                  >
                    <option value="">Select current…</option>
                    {list.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label || s.id.slice(0, 8)} · {fmtDate(s.created_at)}
                      </option>
                    ))}
                  </select>
                </label>
                <Button type="submit" disabled={comparing}>
                  {comparing ? 'Comparing…' : 'Compare'}
                </Button>
              </form>

              {compareError && <p className="text-sm text-red-300">{compareError}</p>}
              {comparing && <Spinner label="Computing diff..." />}

              {compare && !comparing && (
                <div className="space-y-3">
                  <p className="text-xs text-slate-500">
                    {labelOf(aId)} <span className="text-slate-600">→</span> {labelOf(bId)}
                  </p>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <Stat label="Opened" value={fmtSignedArr(compare.opened)} tone="purple" />
                    <Stat label="Converted" value={fmtSignedArr(compare.converted)} tone="green" />
                    <Stat label="Churned" value={fmtSignedArr(compare.churned)} tone="amber" />
                    <Stat label="NRR Movement" value={fmtNrr(compare.nrr_movement)} />
                  </div>
                </div>
              )}
            </CardBody>
          </Card>

          {/* List */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">All Snapshots</h2>
                <Badge tone="slate">{list.length}</Badge>
              </div>
            </CardHeader>
            <CardBody>
              <Table>
                <THead>
                  <TR>
                    <TH>Label</TH>
                    <TH>Captured</TH>
                    <TH className="text-right">Open ARR</TH>
                    <TH className="text-right">Owned ARR</TH>
                    <TH className="text-right">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {list.map((s) => (
                    <TR key={s.id}>
                      <TD className="font-medium text-white">{s.label || `Snapshot ${s.id.slice(0, 8)}`}</TD>
                      <TD className="text-slate-400">{fmtDate(s.created_at)}</TD>
                      <TD className="text-right tabular-nums text-brand-300">
                        {fmtArr(s.total_open_arr_cents)}
                      </TD>
                      <TD className="text-right tabular-nums">{fmtArr(s.total_owned_arr_cents)}</TD>
                      <TD className="text-right">
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => onDelete(s.id)}
                          disabled={deleting === s.id}
                        >
                          {deleting === s.id ? 'Deleting…' : 'Delete'}
                        </Button>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardBody>
          </Card>
        </>
      )}

      <Modal
        open={createOpen}
        onClose={() => {
          if (!creating) setCreateOpen(false)
        }}
        title="Create Snapshot"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button type="submit" form="create-snapshot-form" disabled={creating}>
              {creating ? 'Capturing…' : 'Capture'}
            </Button>
          </>
        }
      >
        <form id="create-snapshot-form" onSubmit={onCreate} className="space-y-4">
          <p className="text-sm text-slate-400">
            Captures current total open and owned whitespace ARR plus grid metrics.
          </p>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-300">Label</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Q2 baseline"
              autoFocus
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none"
            />
            <span className="mt-1 block text-xs text-slate-500">
              Optional. A default label is generated if left blank.
            </span>
          </label>
          {createError && <p className="text-sm text-red-300">{createError}</p>}
        </form>
      </Modal>
    </div>
  )
}
