'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Segment {
  id: string
  name: string
  description?: string | null
  rules?: unknown
  created_at?: string
  updated_at?: string
}

interface Account {
  id: string
  external_id?: string
  name: string
  segment?: string | null
  industry?: string | null
  region?: string | null
  employee_band?: string | null
  plan_tier?: string | null
  csm_owner?: string | null
  current_arr_cents?: number | null
}

function fmtMoney(cents?: number | null): string {
  if (cents == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100)
}

interface FormState {
  name: string
  description: string
  rules: string
}

const EMPTY_FORM: FormState = {
  name: '',
  description: '',
  rules: '{\n  "segment": "Enterprise"\n}',
}

export default function SegmentsPage() {
  const [segments, setSegments] = useState<Segment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Segment | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [deleting, setDeleting] = useState<Segment | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const [previewFor, setPreviewFor] = useState<Segment | null>(null)
  const [members, setMembers] = useState<Account[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [membersError, setMembersError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const s = await api.listSegments()
      setSegments(Array.isArray(s) ? s : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load segments')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return segments
    return segments.filter((s) => `${s.name} ${s.description ?? ''}`.toLowerCase().includes(q))
  }, [segments, search])

  function ruleCount(rules: unknown): number {
    if (rules && typeof rules === 'object' && !Array.isArray(rules)) return Object.keys(rules as object).length
    if (Array.isArray(rules)) return rules.length
    return 0
  }

  function openCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormError(null)
    setFormOpen(true)
  }

  function openEdit(s: Segment) {
    setEditing(s)
    setForm({
      name: s.name ?? '',
      description: s.description ?? '',
      rules: JSON.stringify(s.rules ?? {}, null, 2),
    })
    setFormError(null)
    setFormOpen(true)
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setFormError(null)
    let parsedRules: unknown = {}
    if (form.rules.trim()) {
      try {
        parsedRules = JSON.parse(form.rules)
      } catch {
        setFormError('Rules must be valid JSON.')
        setSaving(false)
        return
      }
    }
    try {
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        rules: parsedRules,
      }
      if (editing) {
        await api.updateSegment(editing.id, body)
      } else {
        await api.createSegment(body)
      }
      setFormOpen(false)
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save segment')
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      await api.deleteSegment(deleting.id)
      setDeleting(null)
      if (previewFor?.id === deleting.id) closePreview()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete segment')
    } finally {
      setDeleteBusy(false)
    }
  }

  async function openPreview(s: Segment) {
    setPreviewFor(s)
    setMembers([])
    setMembersError(null)
    setMembersLoading(true)
    try {
      const m = await api.getSegmentMembers(s.id)
      setMembers(Array.isArray(m) ? m : [])
    } catch (e) {
      setMembersError(e instanceof Error ? e.message : 'Failed to load members')
    } finally {
      setMembersLoading(false)
    }
  }

  function closePreview() {
    setPreviewFor(null)
    setMembers([])
    setMembersError(null)
  }

  const memberArr = useMemo(() => members.reduce((a, m) => a + (m.current_arr_cents || 0), 0), [members])

  if (loading) return <PageSpinner label="Loading segments…" />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Segments</h1>
          <p className="mt-1 text-sm text-slate-400">
            Define reusable account cohorts with rule-based membership, then preview which accounts match.
          </p>
        </div>
        <Button onClick={openCreate}>+ New segment</Button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error} <button className="ml-2 underline" onClick={load}>Retry</button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Stat label="Total segments" value={segments.length} tone="purple" />
        <Stat label="Rule-based" value={segments.filter((s) => ruleCount(s.rules) > 0).length} hint="have membership rules" />
        <Stat label="Static / manual" value={segments.filter((s) => ruleCount(s.rules) === 0).length} tone="amber" hint="no rules defined" />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search segments…"
            className="w-64 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none"
          />
          <span className="text-xs text-slate-500">{filtered.length} of {segments.length} shown</span>
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <EmptyState
              title={segments.length === 0 ? 'No segments yet' : 'No segments match your search'}
              description={
                segments.length === 0
                  ? 'Create a segment with JSON rules (e.g. segment, industry, region, plan_tier) to group accounts for plays and reporting.'
                  : 'Try a different search term.'
              }
              action={segments.length === 0 ? <Button onClick={openCreate}>+ New segment</Button> : undefined}
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Description</TH>
                  <TH className="text-right">Rules</TH>
                  <TH className="text-right">Updated</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((s) => {
                  const rc = ruleCount(s.rules)
                  return (
                    <TR key={s.id}>
                      <TD className="font-medium text-white">{s.name}</TD>
                      <TD className="max-w-xs truncate text-slate-400">{s.description || '—'}</TD>
                      <TD className="text-right">
                        {rc > 0 ? <Badge tone="purple">{rc} rule{rc === 1 ? '' : 's'}</Badge> : <Badge tone="slate">none</Badge>}
                      </TD>
                      <TD className="text-right text-xs text-slate-500">
                        {s.updated_at ? new Date(s.updated_at).toLocaleDateString() : '—'}
                      </TD>
                      <TD className="text-right">
                        <div className="flex justify-end gap-1.5">
                          <Button size="sm" variant="secondary" onClick={() => openPreview(s)}>Members</Button>
                          <Button size="sm" variant="ghost" onClick={() => openEdit(s)}>Edit</Button>
                          <Button size="sm" variant="ghost" className="text-red-300 hover:text-red-200" onClick={() => setDeleting(s)}>Delete</Button>
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
        title={editing ? 'Edit segment' : 'New segment'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button type="submit" form="segment-form" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create segment'}</Button>
          </>
        }
      >
        <form id="segment-form" onSubmit={submitForm} className="space-y-4">
          {formError && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{formError}</p>}
          <Field label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
          <Field label="Description" value={form.description} onChange={(v) => setForm({ ...form, description: v })} />
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-400">Membership rules (JSON)</span>
            <textarea
              value={form.rules}
              onChange={(e) => setForm({ ...form, rules: e.target.value })}
              rows={7}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-200 focus:border-brand-500 focus:outline-none"
            />
            <span className="mt-1 block text-xs text-slate-500">
              Match accounts by attribute, e.g. <code className="rounded bg-slate-800 px-1 text-brand-300">{'{"segment":"Enterprise","region":"NA"}'}</code>
            </span>
          </label>
        </form>
      </Modal>

      {/* Members preview modal */}
      <Modal
        open={!!previewFor}
        onClose={closePreview}
        title={previewFor ? `Members — ${previewFor.name}` : 'Members'}
        className="max-w-3xl"
        footer={<Button variant="ghost" onClick={closePreview}>Close</Button>}
      >
        {membersLoading ? (
          <Spinner label="Resolving membership…" className="py-8" />
        ) : membersError ? (
          <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{membersError}</p>
        ) : members.length === 0 ? (
          <EmptyState
            title="No matching accounts"
            description="No accounts match this segment's rules yet. Adjust the rules or add accounts that match."
          />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-3">
              <Stat label="Matched accounts" value={members.length} tone="purple" />
              <Stat label="Total current ARR" value={fmtMoney(memberArr)} tone="green" />
            </div>
            <div className="max-h-80 overflow-y-auto">
              <Table>
                <THead>
                  <TR>
                    <TH>Account</TH>
                    <TH>Segment</TH>
                    <TH>Region</TH>
                    <TH>CSM</TH>
                    <TH className="text-right">ARR</TH>
                  </TR>
                </THead>
                <TBody>
                  {members.map((m) => (
                    <TR key={m.id}>
                      <TD className="font-medium text-white">{m.name}</TD>
                      <TD className="text-slate-400">{m.segment || '—'}</TD>
                      <TD className="text-slate-400">{m.region || '—'}</TD>
                      <TD className="text-slate-400">{m.csm_owner || '—'}</TD>
                      <TD className="text-right tabular-nums text-emerald-300">{fmtMoney(m.current_arr_cents)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          </div>
        )}
      </Modal>

      {/* Delete confirm modal */}
      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete segment"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="danger" onClick={confirmDelete} disabled={deleteBusy}>{deleteBusy ? 'Deleting…' : 'Delete'}</Button>
          </>
        }
      >
        <p className="text-sm text-slate-300">
          Delete segment <span className="font-semibold text-white">{deleting?.name}</span>? This removes the cohort definition but does not affect any accounts.
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
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  required?: boolean
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
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-brand-500 focus:outline-none"
      />
    </label>
  )
}
