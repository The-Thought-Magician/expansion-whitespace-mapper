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

interface TargetRow {
  id: string
  scope_type: string
  scope_value: string
  period: string
  target_arr_cents: number
  attained_arr_cents?: number | null
  converted_arr_cents?: number | null
  attainment?: number | null
  created_at?: string
  updated_at?: string
}

function fmtMoney(cents?: number | null): string {
  if (cents == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100)
}

function attainmentOf(t: TargetRow): number {
  if (t.attainment != null) return Math.round(t.attainment <= 1 ? t.attainment * 100 : t.attainment)
  const got = t.attained_arr_cents ?? t.converted_arr_cents ?? 0
  if (!t.target_arr_cents) return 0
  return Math.round((got / t.target_arr_cents) * 100)
}

function attainmentTone(p: number): 'red' | 'amber' | 'green' {
  if (p >= 90) return 'green'
  if (p >= 60) return 'amber'
  return 'red'
}

function barColor(p: number): string {
  if (p >= 90) return 'bg-emerald-500'
  if (p >= 60) return 'bg-amber-500'
  return 'bg-red-500'
}

const SCOPE_TYPES = ['csm', 'segment', 'region', 'product', 'global'] as const

interface FormState {
  scope_type: string
  scope_value: string
  period: string
  target_arr: string
}

const EMPTY_FORM: FormState = { scope_type: 'csm', scope_value: '', period: '', target_arr: '' }

export default function TargetsPage() {
  const [targets, setTargets] = useState<TargetRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [scopeFilter, setScopeFilter] = useState<string>('all')
  const [search, setSearch] = useState('')

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<TargetRow | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [deleting, setDeleting] = useState<TargetRow | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const t = await api.listTargets()
      setTargets(Array.isArray(t) ? t : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load targets')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const scopeTypes = useMemo(() => {
    const set = new Set<string>()
    targets.forEach((t) => t.scope_type && set.add(t.scope_type))
    return Array.from(set).sort()
  }, [targets])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return targets.filter((t) => {
      if (scopeFilter !== 'all' && t.scope_type !== scopeFilter) return false
      if (q && !`${t.scope_value} ${t.period} ${t.scope_type}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [targets, scopeFilter, search])

  const summary = useMemo(() => {
    const totalTarget = filtered.reduce((a, t) => a + (t.target_arr_cents || 0), 0)
    const totalAttained = filtered.reduce((a, t) => a + (t.attained_arr_cents ?? t.converted_arr_cents ?? 0), 0)
    const overallPct = totalTarget ? Math.round((totalAttained / totalTarget) * 100) : 0
    const onTrack = filtered.filter((t) => attainmentOf(t) >= 90).length
    return { totalTarget, totalAttained, overallPct, onTrack, count: filtered.length }
  }, [filtered])

  function openCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormError(null)
    setFormOpen(true)
  }

  function openEdit(t: TargetRow) {
    setEditing(t)
    setForm({
      scope_type: t.scope_type ?? 'csm',
      scope_value: t.scope_value ?? '',
      period: t.period ?? '',
      target_arr: t.target_arr_cents != null ? String(t.target_arr_cents / 100) : '',
    })
    setFormError(null)
    setFormOpen(true)
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setFormError(null)
    const dollars = Number(form.target_arr)
    if (!Number.isFinite(dollars) || dollars < 0) {
      setFormError('Target ARR must be a non-negative number.')
      setSaving(false)
      return
    }
    try {
      const body = {
        scope_type: form.scope_type,
        scope_value: form.scope_type === 'global' ? form.scope_value.trim() || 'all' : form.scope_value.trim(),
        period: form.period.trim(),
        target_arr_cents: Math.round(dollars * 100),
      }
      if (editing) {
        await api.updateTarget(editing.id, body)
      } else {
        await api.createTarget(body)
      }
      setFormOpen(false)
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save target')
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      await api.deleteTarget(deleting.id)
      setDeleting(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete target')
    } finally {
      setDeleteBusy(false)
    }
  }

  if (loading) return <PageSpinner label="Loading targets…" />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Targets &amp; Quota</h1>
          <p className="mt-1 text-sm text-slate-400">
            Set expansion ARR targets by CSM, segment, region or product and track attainment against converted whitespace.
          </p>
        </div>
        <Button onClick={openCreate}>+ New target</Button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error} <button className="ml-2 underline" onClick={load}>Retry</button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Targets" value={summary.count} />
        <Stat label="Total target ARR" value={fmtMoney(summary.totalTarget)} tone="purple" />
        <Stat label="Attained ARR" value={fmtMoney(summary.totalAttained)} tone="green" />
        <Stat
          label="Overall attainment"
          value={`${summary.overallPct}%`}
          tone={summary.overallPct >= 90 ? 'green' : 'amber'}
          hint={`${summary.onTrack} target(s) on track`}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search scope or period…"
              className="w-56 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none"
            />
            <div className="flex flex-wrap gap-1">
              <button
                onClick={() => setScopeFilter('all')}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                  scopeFilter === 'all' ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                All
              </button>
              {scopeTypes.map((st) => (
                <button
                  key={st}
                  onClick={() => setScopeFilter(st)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-medium capitalize ${
                    scopeFilter === st ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>
          <span className="text-xs text-slate-500">{filtered.length} shown</span>
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <EmptyState
              title={targets.length === 0 ? 'No targets yet' : 'No targets match your filters'}
              description={
                targets.length === 0
                  ? 'Create an expansion target for a CSM, segment, region or product and track attainment against converted ARR.'
                  : 'Adjust the search or scope filter.'
              }
              action={targets.length === 0 ? <Button onClick={openCreate}>+ New target</Button> : undefined}
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Scope</TH>
                  <TH>Period</TH>
                  <TH className="text-right">Target</TH>
                  <TH className="text-right">Attained</TH>
                  <TH>Attainment</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((t) => {
                  const att = attainmentOf(t)
                  const got = t.attained_arr_cents ?? t.converted_arr_cents ?? 0
                  return (
                    <TR key={t.id}>
                      <TD>
                        <div className="flex items-center gap-2">
                          <Badge tone="blue" className="capitalize">{t.scope_type}</Badge>
                          <span className="font-medium text-white">{t.scope_value}</span>
                        </div>
                      </TD>
                      <TD className="text-slate-300">{t.period}</TD>
                      <TD className="text-right tabular-nums">{fmtMoney(t.target_arr_cents)}</TD>
                      <TD className="text-right tabular-nums text-emerald-300">{fmtMoney(got)}</TD>
                      <TD>
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-28 overflow-hidden rounded-full bg-slate-800">
                            <div className={`h-full ${barColor(att)}`} style={{ width: `${Math.min(att, 100)}%` }} />
                          </div>
                          <Badge tone={attainmentTone(att)}>{att}%</Badge>
                        </div>
                      </TD>
                      <TD className="text-right">
                        <div className="flex justify-end gap-1.5">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(t)}>Edit</Button>
                          <Button size="sm" variant="ghost" className="text-red-300 hover:text-red-200" onClick={() => setDeleting(t)}>Delete</Button>
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

      {/* Create / edit modal */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Edit target' : 'New target'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button type="submit" form="target-form" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create target'}</Button>
          </>
        }
      >
        <form id="target-form" onSubmit={submitForm} className="space-y-4">
          {formError && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{formError}</p>}
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-400">Scope type <span className="text-red-400">*</span></span>
            <select
              value={form.scope_type}
              onChange={(e) => setForm({ ...form, scope_type: e.target.value })}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 capitalize focus:border-brand-500 focus:outline-none"
            >
              {SCOPE_TYPES.map((st) => (
                <option key={st} value={st} className="capitalize">{st}</option>
              ))}
            </select>
          </label>
          <Field
            label={form.scope_type === 'global' ? 'Scope value (optional, e.g. all)' : 'Scope value'}
            value={form.scope_value}
            onChange={(v) => setForm({ ...form, scope_value: v })}
            required={form.scope_type !== 'global'}
            placeholder={form.scope_type === 'csm' ? 'e.g. jordan@co.com' : form.scope_type === 'segment' ? 'e.g. Enterprise' : ''}
          />
          <Field label="Period" value={form.period} onChange={(v) => setForm({ ...form, period: v })} required placeholder="e.g. 2026-Q2" />
          <Field label="Target ARR (USD)" type="number" value={form.target_arr} onChange={(v) => setForm({ ...form, target_arr: v })} required placeholder="e.g. 250000" />
          <p className="text-xs text-slate-500">Targets are upserted by (scope type, scope value, period). Re-saving the same triple updates the existing target.</p>
        </form>
      </Modal>

      {/* Delete confirm modal */}
      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete target"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="danger" onClick={confirmDelete} disabled={deleteBusy}>{deleteBusy ? 'Deleting…' : 'Delete'}</Button>
          </>
        }
      >
        <p className="text-sm text-slate-300">
          Delete the <span className="font-semibold text-white capitalize">{deleting?.scope_type}</span> target for{' '}
          <span className="font-semibold text-white">{deleting?.scope_value}</span> ({deleting?.period})?
        </p>
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
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  required?: boolean
  placeholder?: string
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-400">
        {label}
        {required && <span className="text-red-400"> *</span>}
      </span>
      <input
        type={type}
        value={value}
        required={required}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none"
      />
    </label>
  )
}
