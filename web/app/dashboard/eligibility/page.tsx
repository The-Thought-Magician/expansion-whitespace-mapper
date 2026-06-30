'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

type Condition = { field: string; op: string; value: string }

interface Rule {
  id: string
  name: string
  description?: string | null
  conditions?: unknown
  target_product_id?: string | null
  action?: string | null
  mode?: string | null
  priority?: number | null
  is_active?: boolean | null
  created_at?: string
  updated_at?: string
}

interface Product {
  id: string
  name: string
  sku_code?: string | null
  family?: string | null
  category?: string | null
  is_active?: boolean | null
}

interface PreviewResult {
  affected?: number
  sample?: Array<{
    account_id?: string
    account_name?: string
    product_id?: string
    product_name?: string
    state?: string
    reason?: string
  }>
}

const FIELD_OPTIONS = [
  'segment',
  'industry',
  'region',
  'employee_band',
  'plan_tier',
  'current_arr_cents',
  'csm_owner',
]
const OP_OPTIONS = ['eq', 'neq', 'in', 'gt', 'gte', 'lt', 'lte', 'contains']
const ACTION_OPTIONS = ['eligible', 'ineligible', 'exclude']
const MODE_OPTIONS = ['additive', 'override']

function emptyCondition(): Condition {
  return { field: 'segment', op: 'eq', value: '' }
}

function parseConditions(raw: unknown): Condition[] {
  if (!raw) return []
  let val: any = raw
  if (typeof raw === 'string') {
    try {
      val = JSON.parse(raw)
    } catch {
      return []
    }
  }
  if (Array.isArray(val)) {
    return val
      .filter((c) => c && typeof c === 'object')
      .map((c) => ({
        field: String(c.field ?? ''),
        op: String(c.op ?? 'eq'),
        value: c.value == null ? '' : String(c.value),
      }))
  }
  if (val && typeof val === 'object' && Array.isArray(val.all)) {
    return parseConditions(val.all)
  }
  return []
}

interface RuleForm {
  name: string
  description: string
  target_product_id: string
  action: string
  mode: string
  priority: number
  is_active: boolean
  conditions: Condition[]
}

function blankForm(): RuleForm {
  return {
    name: '',
    description: '',
    target_product_id: '',
    action: 'eligible',
    mode: 'additive',
    priority: 100,
    is_active: true,
    conditions: [emptyCondition()],
  }
}

export default function EligibilityPage() {
  const [rules, setRules] = useState<Rule[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<RuleForm>(blankForm())
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const [previewFor, setPreviewFor] = useState<Rule | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null)
  const [previewError, setPreviewError] = useState('')

  const [applying, setApplying] = useState(false)
  const [applyMsg, setApplyMsg] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const [r, p] = await Promise.all([api.listRules(), api.listProducts()])
      setRules(Array.isArray(r) ? r : [])
      setProducts(Array.isArray(p) ? p : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load eligibility rules')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const productName = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of products) map.set(p.id, p.name)
    return (id?: string | null) => (id ? map.get(id) ?? 'Unknown product' : 'Any product')
  }, [products])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rules.filter((r) => {
      if (statusFilter === 'active' && !r.is_active) return false
      if (statusFilter === 'inactive' && r.is_active) return false
      if (!q) return true
      return (
        r.name.toLowerCase().includes(q) ||
        (r.description ?? '').toLowerCase().includes(q) ||
        productName(r.target_product_id).toLowerCase().includes(q)
      )
    })
  }, [rules, search, statusFilter, productName])

  const stats = useMemo(() => {
    const active = rules.filter((r) => r.is_active).length
    const eligible = rules.filter((r) => (r.action ?? 'eligible') === 'eligible').length
    const exclude = rules.filter((r) => r.action === 'exclude' || r.action === 'ineligible').length
    return { total: rules.length, active, eligible, exclude }
  }, [rules])

  function openCreate() {
    setEditingId(null)
    setForm(blankForm())
    setFormError('')
    setModalOpen(true)
  }

  function openEdit(r: Rule) {
    setEditingId(r.id)
    const conditions = parseConditions(r.conditions)
    setForm({
      name: r.name ?? '',
      description: r.description ?? '',
      target_product_id: r.target_product_id ?? '',
      action: r.action ?? 'eligible',
      mode: r.mode ?? 'additive',
      priority: r.priority ?? 100,
      is_active: r.is_active ?? true,
      conditions: conditions.length ? conditions : [emptyCondition()],
    })
    setFormError('')
    setModalOpen(true)
  }

  async function submitForm() {
    setFormError('')
    if (!form.name.trim()) {
      setFormError('Name is required')
      return
    }
    const conditions = form.conditions
      .filter((c) => c.field && c.value !== '')
      .map((c) => ({ field: c.field, op: c.op, value: c.value }))
    const body = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      target_product_id: form.target_product_id || null,
      action: form.action,
      mode: form.mode,
      priority: Number(form.priority) || 0,
      is_active: form.is_active,
      conditions,
    }
    setSaving(true)
    try {
      if (editingId) {
        await api.updateRule(editingId, body)
      } else {
        await api.createRule(body)
      }
      setModalOpen(false)
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save rule')
    } finally {
      setSaving(false)
    }
  }

  async function remove(r: Rule) {
    if (!confirm(`Delete rule "${r.name}"? This cannot be undone.`)) return
    try {
      await api.deleteRule(r.id)
      setRules((prev) => prev.filter((x) => x.id !== r.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete rule')
    }
  }

  async function toggleActive(r: Rule) {
    try {
      const updated = await api.updateRule(r.id, { is_active: !r.is_active })
      setRules((prev) => prev.map((x) => (x.id === r.id ? { ...x, ...updated } : x)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update rule')
    }
  }

  async function runPreview(r: Rule) {
    setPreviewFor(r)
    setPreviewResult(null)
    setPreviewError('')
    setPreviewLoading(true)
    try {
      const res = await api.previewRule(r.id)
      setPreviewResult(res ?? {})
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : 'Dry-run failed')
    } finally {
      setPreviewLoading(false)
    }
  }

  async function applyAll() {
    setApplyMsg('')
    setApplying(true)
    try {
      const res = await api.applyEligibility()
      const written = res?.cells_written ?? res?.cells ?? 0
      setApplyMsg(`Eligibility applied. ${written} cells written.`)
    } catch (e) {
      setApplyMsg(e instanceof Error ? e.message : 'Apply failed')
    } finally {
      setApplying(false)
    }
  }

  function updateCondition(idx: number, patch: Partial<Condition>) {
    setForm((f) => ({
      ...f,
      conditions: f.conditions.map((c, i) => (i === idx ? { ...c, ...patch } : c)),
    }))
  }

  function actionTone(action?: string | null) {
    if (action === 'exclude' || action === 'ineligible') return 'red' as const
    return 'green' as const
  }

  if (loading) return <PageSpinner label="Loading eligibility rules..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Eligibility Rules</h1>
          <p className="mt-1 text-sm text-slate-400">
            Define who is eligible for which products, dry-run rule impact, then materialize the eligibility grid.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={openCreate}>
            New rule
          </Button>
          <Button onClick={applyAll} disabled={applying}>
            {applying ? 'Applying...' : 'Apply eligibility'}
          </Button>
        </div>
      </div>

      {applyMsg && (
        <div className="rounded-lg border border-purple-500/30 bg-purple-500/10 px-4 py-3 text-sm text-purple-200">
          {applyMsg}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-700 bg-red-900/30 px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Total rules" value={stats.total} />
        <Stat label="Active" value={stats.active} tone="green" />
        <Stat label="Grant rules" value={stats.eligible} tone="purple" />
        <Stat label="Exclude rules" value={stats.exclude} tone="amber" />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search rules..."
              className="w-full max-w-xs rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-purple-500 focus:outline-none"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none"
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <span className="text-xs text-slate-500">{filtered.length} shown</span>
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={rules.length === 0 ? 'No eligibility rules yet' : 'No rules match your filters'}
                description={
                  rules.length === 0
                    ? 'Create a rule to grant product eligibility based on account attributes like segment, industry, or ARR.'
                    : 'Adjust the search or status filter to see more rules.'
                }
                action={
                  rules.length === 0 ? (
                    <Button onClick={openCreate}>Create first rule</Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Rule</TH>
                  <TH>Target product</TH>
                  <TH>Conditions</TH>
                  <TH>Action / Mode</TH>
                  <TH className="text-right">Priority</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((r) => {
                  const conds = parseConditions(r.conditions)
                  return (
                    <TR key={r.id}>
                      <TD>
                        <div className="font-medium text-white">{r.name}</div>
                        {r.description && (
                          <div className="mt-0.5 max-w-xs text-xs text-slate-500">{r.description}</div>
                        )}
                      </TD>
                      <TD className="text-slate-300">{productName(r.target_product_id)}</TD>
                      <TD>
                        {conds.length === 0 ? (
                          <span className="text-xs text-slate-500">All accounts</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {conds.slice(0, 3).map((c, i) => (
                              <span
                                key={i}
                                className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-300"
                              >
                                {c.field} {c.op} {c.value}
                              </span>
                            ))}
                            {conds.length > 3 && (
                              <span className="text-[11px] text-slate-500">+{conds.length - 3}</span>
                            )}
                          </div>
                        )}
                      </TD>
                      <TD>
                        <div className="flex flex-col gap-1">
                          <Badge tone={actionTone(r.action)}>{r.action ?? 'eligible'}</Badge>
                          <span className="text-[11px] text-slate-500">{r.mode ?? 'additive'}</span>
                        </div>
                      </TD>
                      <TD className="text-right tabular-nums text-slate-300">{r.priority ?? 0}</TD>
                      <TD>
                        <button
                          onClick={() => toggleActive(r)}
                          className="focus:outline-none"
                          title="Toggle active"
                        >
                          <Badge tone={r.is_active ? 'green' : 'slate'}>
                            {r.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </button>
                      </TD>
                      <TD className="text-right">
                        <div className="flex justify-end gap-1.5">
                          <Button size="sm" variant="ghost" onClick={() => runPreview(r)}>
                            Dry-run
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>
                            Edit
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => remove(r)}>
                            Delete
                          </Button>
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
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? 'Edit rule' : 'New eligibility rule'}
        className="max-w-2xl"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submitForm} disabled={saving}>
              {saving ? 'Saving...' : editingId ? 'Save changes' : 'Create rule'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-red-700 bg-red-900/30 px-3 py-2 text-sm text-red-300">
              {formError}
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-400">Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none"
                placeholder="Enterprise eligible for Analytics add-on"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-400">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={2}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Target product</label>
              <select
                value={form.target_product_id}
                onChange={(e) => setForm({ ...form, target_product_id: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none"
              >
                <option value="">Any product</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Priority</label>
              <input
                type="number"
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Action</label>
              <select
                value={form.action}
                onChange={(e) => setForm({ ...form, action: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none"
              >
                {ACTION_OPTIONS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Mode</label>
              <select
                value={form.mode}
                onChange={(e) => setForm({ ...form, mode: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none"
              >
                {MODE_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-xs font-medium text-slate-400">Conditions (account attributes)</label>
              <button
                onClick={() => setForm((f) => ({ ...f, conditions: [...f.conditions, emptyCondition()] }))}
                className="text-xs font-medium text-purple-400 hover:text-purple-300"
              >
                + Add condition
              </button>
            </div>
            <div className="space-y-2">
              {form.conditions.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select
                    value={c.field}
                    onChange={(e) => updateCondition(i, { field: e.target.value })}
                    className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-white focus:border-purple-500 focus:outline-none"
                  >
                    {FIELD_OPTIONS.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                  <select
                    value={c.op}
                    onChange={(e) => updateCondition(i, { op: e.target.value })}
                    className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-white focus:border-purple-500 focus:outline-none"
                  >
                    {OP_OPTIONS.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                  <input
                    value={c.value}
                    onChange={(e) => updateCondition(i, { value: e.target.value })}
                    placeholder="value"
                    className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-white focus:border-purple-500 focus:outline-none"
                  />
                  <button
                    onClick={() =>
                      setForm((f) => ({ ...f, conditions: f.conditions.filter((_, idx) => idx !== i) }))
                    }
                    className="rounded-lg px-2 py-1.5 text-slate-500 hover:bg-slate-800 hover:text-red-400"
                    aria-label="Remove condition"
                  >
                    ×
                  </button>
                </div>
              ))}
              {form.conditions.length === 0 && (
                <p className="text-xs text-slate-500">No conditions — rule applies to all accounts.</p>
              )}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              className="h-4 w-4 rounded border-slate-700 bg-slate-800 text-purple-600"
            />
            Active
          </label>
        </div>
      </Modal>

      {/* Dry-run preview modal */}
      <Modal
        open={previewFor !== null}
        onClose={() => setPreviewFor(null)}
        title={previewFor ? `Dry-run — ${previewFor.name}` : 'Dry-run'}
        className="max-w-2xl"
        footer={
          <Button variant="secondary" onClick={() => setPreviewFor(null)}>
            Close
          </Button>
        }
      >
        {previewLoading ? (
          <div className="py-8">
            <PageSpinner label="Computing affected cells..." />
          </div>
        ) : previewError ? (
          <div className="rounded-lg border border-red-700 bg-red-900/30 px-3 py-2 text-sm text-red-300">
            {previewError}
          </div>
        ) : previewResult ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-purple-500/30 bg-purple-500/10 px-4 py-3">
              <div className="text-xs uppercase tracking-wide text-purple-300">Affected cells</div>
              <div className="mt-1 text-2xl font-bold text-white">{previewResult.affected ?? 0}</div>
              <div className="mt-1 text-xs text-slate-400">
                Accounts × products this rule would change if applied. No data is written.
              </div>
            </div>
            {previewResult.sample && previewResult.sample.length > 0 ? (
              <div className="max-h-72 overflow-y-auto">
                <Table>
                  <THead>
                    <TR>
                      <TH>Account</TH>
                      <TH>Product</TH>
                      <TH>New state</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {previewResult.sample.map((s, i) => (
                      <TR key={i}>
                        <TD className="text-slate-200">{s.account_name ?? s.account_id ?? '—'}</TD>
                        <TD className="text-slate-300">{s.product_name ?? s.product_id ?? '—'}</TD>
                        <TD>
                          <Badge tone="purple">{s.state ?? 'eligible'}</Badge>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            ) : (
              <p className="text-sm text-slate-500">No sample rows returned.</p>
            )}
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
