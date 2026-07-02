'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface ImportJob {
  id: string
  entity: string
  status: string
  row_count: number
  error_count: number
  errors?: unknown
  created_at?: string
}

const ENTITIES: { value: string; label: string; columns: string[]; numeric: string[] }[] = [
  { value: 'accounts', label: 'Accounts', columns: ['external_id', 'name', 'segment', 'industry', 'region', 'employee_band', 'csm_owner', 'current_arr_cents'], numeric: ['current_arr_cents'] },
  { value: 'products', label: 'Products / Catalog', columns: ['sku_code', 'name', 'category', 'family', 'product_type', 'default_expansion_arr_cents'], numeric: ['default_expansion_arr_cents'] },
  { value: 'ownership', label: 'Ownership', columns: ['account_id', 'product_id', 'quantity', 'owned_arr_cents'], numeric: ['quantity', 'owned_arr_cents'] },
  { value: 'seats', label: 'Seat usage', columns: ['account_id', 'product_id', 'licensed_seats', 'active_seats', 'assigned_seats'], numeric: ['licensed_seats', 'active_seats', 'assigned_seats'] },
  { value: 'price_book', label: 'Price book', columns: ['product_id', 'segment', 'currency', 'term', 'list_price_cents', 'per_seat_cents'], numeric: ['list_price_cents', 'per_seat_cents'] },
]

function statusTone(s: string): 'green' | 'amber' | 'red' | 'blue' | 'slate' {
  switch (s?.toLowerCase()) {
    case 'completed':
    case 'success':
    case 'done': return 'green'
    case 'partial': return 'amber'
    case 'failed':
    case 'error': return 'red'
    case 'running':
    case 'processing':
    case 'pending': return 'blue'
    default: return 'slate'
  }
}

function fmtDate(s?: string): string {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

function parseCsv(text: string, numeric: Set<string>): Record<string, string | number>[] {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map((h) => h.trim())
  return lines.slice(1).map((line) => {
    const cells = line.split(',').map((c) => c.trim())
    const row: Record<string, string | number> = {}
    headers.forEach((h, i) => {
      const raw = cells[i] ?? ''
      row[h] = numeric.has(h) ? Number(raw) || 0 : raw
    })
    return row
  })
}

export default function ImportsPage() {
  const [jobs, setJobs] = useState<ImportJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'partial' | 'failed'>('all')

  const [open, setOpen] = useState(false)
  const [entity, setEntity] = useState(ENTITIES[0].value)
  const [csv, setCsv] = useState('')
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const j = await api.listImportJobs()
      setJobs(Array.isArray(j) ? j : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load import jobs')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const spec = useMemo(() => ENTITIES.find((e) => e.value === entity) ?? ENTITIES[0], [entity])
  const parsedPreview = useMemo(() => parseCsv(csv, new Set(spec.numeric)), [csv, spec])

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return jobs
    return jobs.filter((j) => {
      const t = statusTone(j.status)
      if (statusFilter === 'completed') return t === 'green'
      if (statusFilter === 'partial') return t === 'amber'
      if (statusFilter === 'failed') return t === 'red'
      return true
    })
  }, [jobs, statusFilter])

  const summary = useMemo(() => {
    const totalRows = jobs.reduce((a, j) => a + (j.row_count || 0), 0)
    const totalErrors = jobs.reduce((a, j) => a + (j.error_count || 0), 0)
    const failed = jobs.filter((j) => statusTone(j.status) === 'red').length
    return { totalRows, totalErrors, failed }
  }, [jobs])

  function openRun() {
    setEntity(ENTITIES[0].value)
    setCsv('')
    setRunError(null)
    setOpen(true)
  }

  async function runJob() {
    setRunning(true)
    setRunError(null)
    try {
      const rows = parseCsv(csv, new Set(spec.numeric))
      if (rows.length === 0) throw new Error('No rows parsed — include a header row plus at least one data row.')
      await api.runImport({ entity, rows, mapping: spec.columns.reduce<Record<string, string>>((m, c) => { m[c] = c; return m }, {}) })
      setOpen(false)
      await load()
    } catch (e) {
      setRunError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setRunning(false)
    }
  }

  if (loading) return <PageSpinner label="Loading import jobs…" />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Data Imports</h1>
          <p className="mt-1 text-sm text-slate-400">
            Bulk-load accounts, catalog, ownership and seats. Every run is logged with row and error counts.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={load}>Refresh</Button>
          <Button onClick={openRun}>+ New import</Button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error} <button className="ml-2 underline" onClick={load}>Retry</button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Import jobs" value={jobs.length.toLocaleString()} />
        <Stat label="Rows imported" value={summary.totalRows.toLocaleString()} tone="purple" />
        <Stat label="Row errors" value={summary.totalErrors.toLocaleString()} tone={summary.totalErrors ? 'amber' : 'green'} />
        <Stat label="Failed jobs" value={summary.failed} tone={summary.failed ? 'amber' : 'green'} />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-white">Job history</h2>
          <div className="flex gap-1">
            {([
              ['all', 'All'],
              ['completed', 'Completed'],
              ['partial', 'Partial'],
              ['failed', 'Failed'],
            ] as const).map(([v, l]) => (
              <button
                key={v}
                onClick={() => setStatusFilter(v)}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                  statusFilter === v ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {l}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <EmptyState
              title={jobs.length === 0 ? 'No imports yet' : 'No jobs match this filter'}
              description={
                jobs.length === 0
                  ? 'Run an import to bulk-load your accounts, catalog, ownership or seat usage.'
                  : 'Try a different status filter.'
              }
              action={jobs.length === 0 ? <Button onClick={openRun}>+ New import</Button> : undefined}
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Entity</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Rows</TH>
                  <TH className="text-right">Errors</TH>
                  <TH className="text-right">When</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((j) => (
                  <TR key={j.id}>
                    <TD className="font-medium capitalize text-white">{j.entity?.replace(/_/g, ' ')}</TD>
                    <TD><Badge tone={statusTone(j.status)}>{j.status}</Badge></TD>
                    <TD className="text-right tabular-nums">{(j.row_count ?? 0).toLocaleString()}</TD>
                    <TD className="text-right tabular-nums">
                      {j.error_count ? <span className="text-amber-300">{j.error_count}</span> : <span className="text-slate-500">0</span>}
                    </TD>
                    <TD className="text-right text-xs text-slate-500">{fmtDate(j.created_at)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Run data import"
        className="max-w-2xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={runJob} disabled={running || !csv.trim()}>
              {running ? 'Importing…' : `Import ${parsedPreview.length || ''} row(s)`}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-400">Entity</span>
            <select
              value={entity}
              onChange={(e) => setEntity(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-brand-500 focus:outline-none"
            >
              {ENTITIES.map((e) => (
                <option key={e.value} value={e.value}>{e.label}</option>
              ))}
            </select>
          </label>

          <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
            <span className="text-xs font-medium text-slate-400">Expected columns</span>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {spec.columns.map((c) => (
                <code key={c} className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-brand-300">{c}</code>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-400">CSV data (header row required)</span>
            <textarea
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              rows={9}
              placeholder={`${spec.columns.join(',')}\n${spec.columns.map((c) => spec.numeric.includes(c) ? '0' : `sample-${c}`).join(',')}`}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-200 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none"
            />
          </label>

          {csv.trim() && (
            <p className="text-xs text-slate-500">
              {parsedPreview.length > 0
                ? `Parsed ${parsedPreview.length} data row(s) ready to import.`
                : 'No data rows parsed yet — make sure you have a header line and at least one row.'}
            </p>
          )}

          {runError && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{runError}</p>}
        </div>
      </Modal>
    </div>
  )
}
