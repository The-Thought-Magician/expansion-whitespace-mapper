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

interface SeatRow {
  id: string
  account_id: string
  product_id: string
  account_name?: string
  product_name?: string
  licensed_seats: number
  active_seats: number
  assigned_seats: number
  as_of?: string
  penetration?: number
}

interface OverageRow {
  id?: string
  account_id: string
  product_id: string
  account_name?: string
  product_name?: string
  licensed_seats: number
  active_seats: number
  overage_seats?: number
  per_seat_cents?: number
  upsell_arr_cents?: number
}

function fmtMoney(cents?: number | null): string {
  if (cents == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100)
}

function pct(part: number, whole: number): number {
  if (!whole) return 0
  return Math.round((part / whole) * 100)
}

function penetrationTone(p: number): 'red' | 'amber' | 'green' {
  if (p >= 85) return 'green'
  if (p >= 50) return 'amber'
  return 'red'
}

function barColor(p: number): string {
  if (p >= 85) return 'bg-emerald-500'
  if (p >= 50) return 'bg-amber-500'
  return 'bg-red-500'
}

const EMPTY_FORM = { account_id: '', product_id: '', licensed_seats: '', active_seats: '', assigned_seats: '' }

export default function SeatsPage() {
  const [seats, setSeats] = useState<SeatRow[]>([])
  const [overage, setOverage] = useState<OverageRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [tab, setTab] = useState<'penetration' | 'overage'>('penetration')
  const [search, setSearch] = useState('')
  const [penFilter, setPenFilter] = useState<'all' | 'low' | 'mid' | 'high'>('all')

  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ imported: number; errors: number } | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [s, o] = await Promise.all([api.listSeats(), api.listSeatOverage()])
      setSeats(Array.isArray(s) ? s : [])
      setOverage(Array.isArray(o) ? o : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load seat data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const enriched = useMemo(
    () =>
      seats.map((r) => ({
        ...r,
        penetration: r.penetration ?? pct(r.active_seats, r.licensed_seats),
      })),
    [seats],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return enriched.filter((r) => {
      if (q) {
        const hay = `${r.account_name ?? r.account_id} ${r.product_name ?? r.product_id}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      const p = r.penetration ?? 0
      if (penFilter === 'low' && p >= 50) return false
      if (penFilter === 'mid' && (p < 50 || p >= 85)) return false
      if (penFilter === 'high' && p < 85) return false
      return true
    })
  }, [enriched, search, penFilter])

  const summary = useMemo(() => {
    const totalLicensed = enriched.reduce((a, r) => a + (r.licensed_seats || 0), 0)
    const totalActive = enriched.reduce((a, r) => a + (r.active_seats || 0), 0)
    const totalAssigned = enriched.reduce((a, r) => a + (r.assigned_seats || 0), 0)
    const avgPen = enriched.length
      ? Math.round(enriched.reduce((a, r) => a + (r.penetration ?? 0), 0) / enriched.length)
      : 0
    const overageArr = overage.reduce((a, r) => a + (r.upsell_arr_cents || 0), 0)
    return { totalLicensed, totalActive, totalAssigned, avgPen, overageArr, atRisk: enriched.filter((r) => (r.penetration ?? 0) < 50).length }
  }, [enriched, overage])

  function openCreate() {
    setForm(EMPTY_FORM)
    setFormError(null)
    setFormOpen(true)
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setFormError(null)
    try {
      await api.upsertSeat({
        account_id: form.account_id.trim(),
        product_id: form.product_id.trim(),
        licensed_seats: Number(form.licensed_seats) || 0,
        active_seats: Number(form.active_seats) || 0,
        assigned_seats: Number(form.assigned_seats) || 0,
      })
      setFormOpen(false)
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save seat record')
    } finally {
      setSaving(false)
    }
  }

  async function submitImport() {
    setImporting(true)
    setImportError(null)
    setImportResult(null)
    try {
      const rows = parseCsv(importText)
      if (rows.length === 0) throw new Error('No rows parsed — provide a header row plus at least one data row')
      const res = await api.importSeats({ rows })
      setImportResult({ imported: res?.imported ?? rows.length, errors: res?.errors ?? 0 })
      await load()
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  if (loading) return <PageSpinner label="Loading seat penetration…" />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Seat Penetration</h1>
          <p className="mt-1 text-sm text-slate-400">
            Track licensed vs active seats per account and surface overage as expansion upsell.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => { setImportText(''); setImportResult(null); setImportError(null); setImportOpen(true) }}>
            Import CSV
          </Button>
          <Button onClick={openCreate}>+ Seat record</Button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error} <button className="ml-2 underline" onClick={load}>Retry</button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Licensed seats" value={summary.totalLicensed.toLocaleString()} />
        <Stat label="Active seats" value={summary.totalActive.toLocaleString()} tone="purple" />
        <Stat label="Avg penetration" value={`${summary.avgPen}%`} tone={summary.avgPen >= 70 ? 'green' : 'amber'} />
        <Stat label="Low-adoption cells" value={summary.atRisk} tone="amber" hint="< 50% penetration" />
        <Stat label="Overage upsell ARR" value={fmtMoney(summary.overageArr)} tone="green" hint={`${overage.length} overage cells`} />
      </div>

      <div className="flex gap-1 border-b border-slate-800">
        {(['penetration', 'overage'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === t ? 'border-brand-500 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {t === 'penetration' ? `Penetration tracker (${enriched.length})` : `Overage upsell (${overage.length})`}
          </button>
        ))}
      </div>

      {tab === 'penetration' ? (
        <Card>
          <CardHeader className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search account or product…"
                className="w-60 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none"
              />
              <div className="flex gap-1">
                {([
                  ['all', 'All'],
                  ['low', '< 50%'],
                  ['mid', '50–84%'],
                  ['high', '≥ 85%'],
                ] as const).map(([v, l]) => (
                  <button
                    key={v}
                    onClick={() => setPenFilter(v)}
                    className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                      penFilter === v ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <span className="text-xs text-slate-500">{filtered.length} shown</span>
          </CardHeader>
          <CardBody className="p-0">
            {filtered.length === 0 ? (
              <EmptyState
                title={enriched.length === 0 ? 'No seat usage yet' : 'No rows match your filters'}
                description={
                  enriched.length === 0
                    ? 'Add a seat record or import a CSV of licensed/active/assigned seats per account and product.'
                    : 'Adjust the search or penetration filter.'
                }
                action={enriched.length === 0 ? <Button onClick={openCreate}>+ Seat record</Button> : undefined}
              />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Account</TH>
                    <TH>Product</TH>
                    <TH className="text-right">Licensed</TH>
                    <TH className="text-right">Active</TH>
                    <TH className="text-right">Assigned</TH>
                    <TH>Penetration</TH>
                    <TH className="text-right">As of</TH>
                  </TR>
                </THead>
                <TBody>
                  {filtered.map((r) => {
                    const p = r.penetration ?? 0
                    return (
                      <TR key={r.id}>
                        <TD className="font-medium text-white">{r.account_name ?? r.account_id}</TD>
                        <TD className="text-slate-300">{r.product_name ?? r.product_id}</TD>
                        <TD className="text-right tabular-nums">{r.licensed_seats}</TD>
                        <TD className="text-right tabular-nums">{r.active_seats}</TD>
                        <TD className="text-right tabular-nums">{r.assigned_seats}</TD>
                        <TD>
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-28 overflow-hidden rounded-full bg-slate-800">
                              <div className={`h-full ${barColor(p)}`} style={{ width: `${Math.min(p, 100)}%` }} />
                            </div>
                            <Badge tone={penetrationTone(p)}>{p}%</Badge>
                          </div>
                        </TD>
                        <TD className="text-right text-xs text-slate-500">
                          {r.as_of ? new Date(r.as_of).toLocaleDateString() : '—'}
                        </TD>
                      </TR>
                    )
                  })}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-white">Overage as upsell</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Accounts where active seats exceed their licensed count — sized at the price-book per-seat rate.
            </p>
          </CardHeader>
          <CardBody className="p-0">
            {overage.length === 0 ? (
              <EmptyState
                title="No overage detected"
                description="Every account is within its licensed seat count. Overage appears here when active > licensed."
              />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Account</TH>
                    <TH>Product</TH>
                    <TH className="text-right">Licensed</TH>
                    <TH className="text-right">Active</TH>
                    <TH className="text-right">Overage</TH>
                    <TH className="text-right">Per seat</TH>
                    <TH className="text-right">Upsell ARR</TH>
                  </TR>
                </THead>
                <TBody>
                  {overage.map((r, i) => {
                    const over = r.overage_seats ?? Math.max(0, r.active_seats - r.licensed_seats)
                    return (
                      <TR key={r.id ?? `${r.account_id}-${r.product_id}-${i}`}>
                        <TD className="font-medium text-white">{r.account_name ?? r.account_id}</TD>
                        <TD className="text-slate-300">{r.product_name ?? r.product_id}</TD>
                        <TD className="text-right tabular-nums">{r.licensed_seats}</TD>
                        <TD className="text-right tabular-nums">{r.active_seats}</TD>
                        <TD className="text-right tabular-nums">
                          <Badge tone="amber">+{over}</Badge>
                        </TD>
                        <TD className="text-right tabular-nums text-slate-400">{fmtMoney(r.per_seat_cents)}</TD>
                        <TD className="text-right font-semibold text-emerald-300">{fmtMoney(r.upsell_arr_cents)}</TD>
                      </TR>
                    )
                  })}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title="Upsert seat record"
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button type="submit" form="seat-form" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </>
        }
      >
        <form id="seat-form" onSubmit={submitForm} className="space-y-4">
          {formError && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{formError}</p>}
          <Field label="Account ID" value={form.account_id} onChange={(v) => setForm({ ...form, account_id: v })} required />
          <Field label="Product ID" value={form.product_id} onChange={(v) => setForm({ ...form, product_id: v })} required />
          <div className="grid grid-cols-3 gap-3">
            <Field label="Licensed" type="number" value={form.licensed_seats} onChange={(v) => setForm({ ...form, licensed_seats: v })} required />
            <Field label="Active" type="number" value={form.active_seats} onChange={(v) => setForm({ ...form, active_seats: v })} required />
            <Field label="Assigned" type="number" value={form.assigned_seats} onChange={(v) => setForm({ ...form, assigned_seats: v })} />
          </div>
          <p className="text-xs text-slate-500">Records are upserted by (account, product). Re-saving updates the existing cell.</p>
        </form>
      </Modal>

      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import seat usage"
        footer={
          <>
            <Button variant="ghost" onClick={() => setImportOpen(false)}>Close</Button>
            <Button onClick={submitImport} disabled={importing || !importText.trim()}>{importing ? 'Importing…' : 'Run import'}</Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-400">
            Paste CSV with a header row. Expected columns:{' '}
            <code className="rounded bg-slate-800 px-1 text-brand-300">account_id, product_id, licensed_seats, active_seats, assigned_seats</code>
          </p>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            rows={8}
            placeholder={'account_id,product_id,licensed_seats,active_seats,assigned_seats\nacc-1,prod-1,100,72,80'}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-200 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none"
          />
          {importError && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{importError}</p>}
          {importResult && (
            <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
              Imported {importResult.imported} row(s){importResult.errors ? `, ${importResult.errors} error(s)` : ''}.
            </p>
          )}
        </div>
      </Modal>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  required,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  required?: boolean
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-400">{label}{required && <span className="text-red-400"> *</span>}</span>
      <input
        type={type}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-brand-500 focus:outline-none"
      />
    </label>
  )
}

function parseCsv(text: string): Record<string, string | number>[] {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map((h) => h.trim())
  const numeric = new Set(['licensed_seats', 'active_seats', 'assigned_seats'])
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
