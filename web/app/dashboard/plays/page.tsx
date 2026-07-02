'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Play {
  id: string
  account_id: string
  product_id: string
  account_name?: string
  product_name?: string
  play_type: string
  open_arr_cents: number
  stage: string
  owner?: string
  due_date?: string
  notes?: string
  created_at?: string
}

const STAGES = ['identified', 'qualified', 'proposed', 'won', 'lost'] as const
type Stage = (typeof STAGES)[number]

const STAGE_LABELS: Record<string, string> = {
  identified: 'Identified',
  qualified: 'Qualified',
  proposed: 'Proposed',
  won: 'Won',
  lost: 'Lost',
}

const STAGE_TONE: Record<string, 'slate' | 'blue' | 'purple' | 'green' | 'red'> = {
  identified: 'slate',
  qualified: 'blue',
  proposed: 'purple',
  won: 'green',
  lost: 'red',
}

const PLAY_TYPES = ['cross_sell', 'upsell', 'seat_expansion', 'renewal_uplift'] as const

function fmtMoney(cents?: number | null): string {
  if (cents == null) return '$0'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100)
}

const EMPTY_FORM = {
  account_id: '',
  product_id: '',
  play_type: 'cross_sell',
  open_arr_cents: '',
  owner: '',
  due_date: '',
  notes: '',
}

export default function PlaysPage() {
  const [plays, setPlays] = useState<Play[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [view, setView] = useState<'board' | 'list'>('board')
  const [search, setSearch] = useState('')
  const [ownerFilter, setOwnerFilter] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const data = await api.listPlays()
      setPlays(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load plays')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const owners = useMemo(() => Array.from(new Set(plays.map((p) => p.owner).filter(Boolean))) as string[], [plays])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return plays.filter((p) => {
      if (ownerFilter && p.owner !== ownerFilter) return false
      if (q) {
        const hay = `${p.account_name ?? p.account_id} ${p.product_name ?? p.product_id} ${p.play_type}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [plays, search, ownerFilter])

  const byStage = useMemo(() => {
    const map: Record<string, Play[]> = {}
    for (const s of STAGES) map[s] = []
    for (const p of filtered) {
      ;(map[p.stage] ??= []).push(p)
    }
    return map
  }, [filtered])

  const summary = useMemo(() => {
    const open = filtered.filter((p) => p.stage !== 'won' && p.stage !== 'lost')
    const openArr = open.reduce((a, p) => a + (p.open_arr_cents || 0), 0)
    const wonArr = filtered.filter((p) => p.stage === 'won').reduce((a, p) => a + (p.open_arr_cents || 0), 0)
    const closed = filtered.filter((p) => p.stage === 'won' || p.stage === 'lost').length
    const wonCount = filtered.filter((p) => p.stage === 'won').length
    return {
      total: filtered.length,
      openArr,
      wonArr,
      openCount: open.length,
      winRate: closed ? Math.round((wonCount / closed) * 100) : 0,
    }
  }, [filtered])

  async function transition(p: Play, stage: Stage) {
    setBusyId(p.id)
    try {
      await api.transitionPlay(p.id, stage)
      setPlays((prev) => prev.map((x) => (x.id === p.id ? { ...x, stage } : x)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to transition play')
    } finally {
      setBusyId(null)
    }
  }

  async function remove(p: Play) {
    if (!confirm(`Delete this ${p.play_type} play? This cannot be undone.`)) return
    setBusyId(p.id)
    try {
      await api.deletePlay(p.id)
      setPlays((prev) => prev.filter((x) => x.id !== p.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete play')
    } finally {
      setBusyId(null)
    }
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setFormError(null)
    try {
      await api.createPlay({
        account_id: form.account_id.trim(),
        product_id: form.product_id.trim(),
        play_type: form.play_type,
        open_arr_cents: Math.round((Number(form.open_arr_cents) || 0) * 100),
        owner: form.owner.trim() || undefined,
        due_date: form.due_date || undefined,
        notes: form.notes.trim() || undefined,
      })
      setFormOpen(false)
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create play')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <PageSpinner label="Loading play queue…" />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Expansion Play Queue</h1>
          <p className="mt-1 text-sm text-slate-400">Work cross-sell, upsell and seat-expansion plays through to won ARR.</p>
        </div>
        <Button onClick={() => { setForm(EMPTY_FORM); setFormError(null); setFormOpen(true) }}>+ New play</Button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error} <button className="ml-2 underline" onClick={load}>Retry</button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Open plays" value={summary.openCount} hint={`${summary.total} total`} />
        <Stat label="Open pipeline ARR" value={fmtMoney(summary.openArr)} tone="purple" />
        <Stat label="Won ARR" value={fmtMoney(summary.wonArr)} tone="green" />
        <Stat label="Win rate" value={`${summary.winRate}%`} tone={summary.winRate >= 50 ? 'green' : 'amber'} />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search account, product, type…"
              className="w-64 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none"
            />
            <select
              value={ownerFilter}
              onChange={(e) => setOwnerFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 focus:border-brand-500 focus:outline-none"
            >
              <option value="">All owners</option>
              {owners.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-1 rounded-lg border border-slate-700 p-0.5">
            {(['board', 'list'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded-md px-3 py-1 text-xs font-medium capitalize ${
                  view === v ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardBody className={view === 'board' ? '' : 'p-0'}>
          {filtered.length === 0 ? (
            <EmptyState
              title={plays.length === 0 ? 'No plays yet' : 'No plays match your filters'}
              description={
                plays.length === 0
                  ? 'Create plays here, or generate them in bulk from sized whitespace on the Grid.'
                  : 'Clear the search or owner filter to see more.'
              }
              action={plays.length === 0 ? <Button onClick={() => setFormOpen(true)}>+ New play</Button> : undefined}
            />
          ) : view === 'board' ? (
            <div className="grid gap-3 lg:grid-cols-5">
              {STAGES.map((stage) => {
                const col = byStage[stage] ?? []
                const colArr = col.reduce((a, p) => a + (p.open_arr_cents || 0), 0)
                return (
                  <div key={stage} className="flex flex-col rounded-xl border border-slate-800 bg-slate-950/40">
                    <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
                      <Badge tone={STAGE_TONE[stage]}>{STAGE_LABELS[stage]}</Badge>
                      <span className="text-xs text-slate-500">{col.length}</span>
                    </div>
                    <div className="px-3 py-1.5 text-xs text-slate-500">{fmtMoney(colArr)}</div>
                    <div className="flex-1 space-y-2 p-2">
                      {col.length === 0 ? (
                        <p className="px-1 py-4 text-center text-xs text-slate-600">Empty</p>
                      ) : (
                        col.map((p) => (
                          <div key={p.id} className="rounded-lg border border-slate-800 bg-slate-900 p-3 hover:border-brand-500/40">
                            <Link href={`/dashboard/plays/${p.id}`} className="block">
                              <div className="text-sm font-medium text-white hover:text-brand-300">{p.account_name ?? p.account_id}</div>
                              <div className="mt-0.5 text-xs text-slate-400">{p.product_name ?? p.product_id}</div>
                            </Link>
                            <div className="mt-2 flex items-center justify-between">
                              <span className="text-xs font-semibold text-emerald-300">{fmtMoney(p.open_arr_cents)}</span>
                              <span className="text-[10px] uppercase tracking-wide text-slate-500">{p.play_type.replace(/_/g, ' ')}</span>
                            </div>
                            {p.owner && <div className="mt-1 text-[11px] text-slate-500">@ {p.owner}</div>}
                            <div className="mt-2 flex items-center gap-1.5">
                              <select
                                value={p.stage}
                                disabled={busyId === p.id}
                                onChange={(e) => transition(p, e.target.value as Stage)}
                                className="flex-1 rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-[11px] text-slate-300 focus:border-brand-500 focus:outline-none"
                              >
                                {STAGES.map((s) => (
                                  <option key={s} value={s}>{STAGE_LABELS[s]}</option>
                                ))}
                              </select>
                              <button
                                onClick={() => remove(p)}
                                disabled={busyId === p.id}
                                className="rounded p-1 text-slate-600 hover:bg-red-500/10 hover:text-red-400"
                                aria-label="Delete play"
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                </svg>
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Account</TH>
                  <TH>Product</TH>
                  <TH>Type</TH>
                  <TH className="text-right">Open ARR</TH>
                  <TH>Stage</TH>
                  <TH>Owner</TH>
                  <TH>Due</TH>
                  <TH></TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((p) => (
                  <TR key={p.id}>
                    <TD className="font-medium text-white">
                      <Link href={`/dashboard/plays/${p.id}`} className="hover:text-brand-300">{p.account_name ?? p.account_id}</Link>
                    </TD>
                    <TD className="text-slate-300">{p.product_name ?? p.product_id}</TD>
                    <TD className="text-xs uppercase tracking-wide text-slate-400">{p.play_type.replace(/_/g, ' ')}</TD>
                    <TD className="text-right font-semibold text-emerald-300">{fmtMoney(p.open_arr_cents)}</TD>
                    <TD>
                      <select
                        value={p.stage}
                        disabled={busyId === p.id}
                        onChange={(e) => transition(p, e.target.value as Stage)}
                        className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-300 focus:border-brand-500 focus:outline-none"
                      >
                        {STAGES.map((s) => (
                          <option key={s} value={s}>{STAGE_LABELS[s]}</option>
                        ))}
                      </select>
                    </TD>
                    <TD className="text-slate-400">{p.owner ?? '—'}</TD>
                    <TD className="text-xs text-slate-500">{p.due_date ? new Date(p.due_date).toLocaleDateString() : '—'}</TD>
                    <TD className="text-right">
                      <button
                        onClick={() => remove(p)}
                        disabled={busyId === p.id}
                        className="rounded p-1 text-slate-600 hover:bg-red-500/10 hover:text-red-400"
                        aria-label="Delete play"
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title="New expansion play"
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button type="submit" form="play-form" disabled={saving}>{saving ? 'Creating…' : 'Create play'}</Button>
          </>
        }
      >
        <form id="play-form" onSubmit={submitForm} className="space-y-4">
          {formError && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{formError}</p>}
          <Field label="Account ID" value={form.account_id} onChange={(v) => setForm({ ...form, account_id: v })} required />
          <Field label="Product ID" value={form.product_id} onChange={(v) => setForm({ ...form, product_id: v })} required />
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-400">Play type</span>
              <select
                value={form.play_type}
                onChange={(e) => setForm({ ...form, play_type: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-brand-500 focus:outline-none"
              >
                {PLAY_TYPES.map((t) => (
                  <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </label>
            <Field label="Open ARR ($)" type="number" value={form.open_arr_cents} onChange={(v) => setForm({ ...form, open_arr_cents: v })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Owner" value={form.owner} onChange={(v) => setForm({ ...form, owner: v })} />
            <Field label="Due date" type="date" value={form.due_date} onChange={(v) => setForm({ ...form, due_date: v })} />
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-400">Notes</span>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={3}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-brand-500 focus:outline-none"
            />
          </label>
        </form>
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
