'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

function fmtMoney(cents: number | null | undefined): string {
  const n = Number(cents ?? 0) / 100
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

type Account = {
  id: string
  external_id?: string | null
  name: string
  segment?: string | null
  industry?: string | null
  region?: string | null
  employee_band?: string | null
  plan_tier?: string | null
  csm_owner?: string | null
  current_arr_cents?: number | null
}

const PLAN_TONE: Record<string, 'green' | 'purple' | 'amber' | 'slate'> = {
  enterprise: 'purple',
  pro: 'green',
  growth: 'amber',
  free: 'slate',
}

const EMPTY_FORM = {
  external_id: '',
  name: '',
  segment: '',
  industry: '',
  region: '',
  employee_band: '',
  plan_tier: '',
  csm_owner: '',
  current_arr: '',
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // filters
  const [segment, setSegment] = useState('')
  const [csm, setCsm] = useState('')
  const [region, setRegion] = useState('')
  const [industry, setIndustry] = useState('')
  const [search, setSearch] = useState('')

  // create modal
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // delete
  const [toDelete, setToDelete] = useState<Account | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params: Record<string, string> = {}
      if (segment) params.segment = segment
      if (csm) params.csm_owner = csm
      if (region) params.region = region
      if (industry) params.industry = industry
      const data = await api.listAccounts(Object.keys(params).length ? params : undefined)
      setAccounts(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load accounts')
    } finally {
      setLoading(false)
    }
  }, [segment, csm, region, industry])

  useEffect(() => {
    void load()
  }, [load])

  const segments = useMemo(
    () => [...new Set(accounts.map((a) => a.segment).filter(Boolean) as string[])].sort(),
    [accounts],
  )
  const csms = useMemo(
    () => [...new Set(accounts.map((a) => a.csm_owner).filter(Boolean) as string[])].sort(),
    [accounts],
  )
  const regions = useMemo(
    () => [...new Set(accounts.map((a) => a.region).filter(Boolean) as string[])].sort(),
    [accounts],
  )
  const industries = useMemo(
    () => [...new Set(accounts.map((a) => a.industry).filter(Boolean) as string[])].sort(),
    [accounts],
  )

  const visible = useMemo(() => {
    if (!search.trim()) return accounts
    const q = search.toLowerCase()
    return accounts.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        (a.external_id ?? '').toLowerCase().includes(q) ||
        (a.csm_owner ?? '').toLowerCase().includes(q),
    )
  }, [accounts, search])

  const totalArr = useMemo(
    () => visible.reduce((s, a) => s + (Number(a.current_arr_cents) || 0), 0),
    [visible],
  )

  const create = async () => {
    if (!form.name.trim()) {
      setFormError('Name is required')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const body: Record<string, unknown> = { name: form.name.trim() }
      if (form.external_id.trim()) body.external_id = form.external_id.trim()
      if (form.segment.trim()) body.segment = form.segment.trim()
      if (form.industry.trim()) body.industry = form.industry.trim()
      if (form.region.trim()) body.region = form.region.trim()
      if (form.employee_band.trim()) body.employee_band = form.employee_band.trim()
      if (form.plan_tier.trim()) body.plan_tier = form.plan_tier.trim()
      if (form.csm_owner.trim()) body.csm_owner = form.csm_owner.trim()
      if (form.current_arr.trim()) body.current_arr_cents = Math.round(Number(form.current_arr) * 100)
      await api.createAccount(body)
      setCreateOpen(false)
      setForm({ ...EMPTY_FORM })
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create account')
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!toDelete) return
    setDeleting(true)
    setError(null)
    try {
      await api.deleteAccount(toDelete.id)
      setToDelete(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete account')
    } finally {
      setDeleting(false)
    }
  }

  const clearFilters = () => {
    setSegment('')
    setCsm('')
    setRegion('')
    setIndustry('')
    setSearch('')
  }

  const setField = (k: keyof typeof EMPTY_FORM, v: string) => setForm((f) => ({ ...f, [k]: v }))

  if (loading && accounts.length === 0) return <PageSpinner label="Loading accounts..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Accounts</h1>
          <p className="mt-1 text-sm text-slate-400">
            Your install base. Filter by segment, CSM, region, or industry, and open any account for its whitespace one-pager.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => void load()}>
            Refresh
          </Button>
          <Button onClick={() => setCreateOpen(true)}>New account</Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3">
          <div className="text-xs uppercase tracking-wide text-slate-500">Accounts</div>
          <div className="mt-1 text-xl font-bold text-white">{visible.length}</div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3">
          <div className="text-xs uppercase tracking-wide text-slate-500">Current ARR</div>
          <div className="mt-1 text-xl font-bold text-emerald-300">{fmtMoney(totalArr)}</div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3">
          <div className="text-xs uppercase tracking-wide text-slate-500">CSMs</div>
          <div className="mt-1 text-xl font-bold text-white">{csms.length}</div>
        </div>
      </div>

      <Card>
        <CardBody className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[180px]">
            <label className="mb-1 block text-xs text-slate-500">Search</label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, external ID, or CSM..."
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-600 focus:border-brand-500 focus:outline-none"
            />
          </div>
          <FilterSelect label="Segment" value={segment} onChange={setSegment} options={segments} />
          <FilterSelect label="CSM" value={csm} onChange={setCsm} options={csms} />
          <FilterSelect label="Region" value={region} onChange={setRegion} options={regions} />
          <FilterSelect label="Industry" value={industry} onChange={setIndustry} options={industries} />
          <Button variant="ghost" onClick={clearFilters}>
            Clear
          </Button>
        </CardBody>
      </Card>

      {loading ? (
        <Spinner label="Refreshing..." className="py-10" />
      ) : visible.length === 0 ? (
        <EmptyState
          title="No accounts found"
          description="Adjust your filters or create your first account to start mapping whitespace."
          icon={<span>◴</span>}
          action={<Button onClick={() => setCreateOpen(true)}>New account</Button>}
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Account</TH>
              <TH>Segment</TH>
              <TH>Industry</TH>
              <TH>Region</TH>
              <TH>CSM</TH>
              <TH>Plan</TH>
              <TH className="text-right">Current ARR</TH>
              <TH className="text-right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {visible.map((a) => (
              <TR key={a.id}>
                <TD>
                  <Link href={`/dashboard/accounts/${a.id}`} className="font-medium text-white hover:text-brand-300">
                    {a.name}
                  </Link>
                  {a.external_id && <div className="text-[11px] text-slate-500">{a.external_id}</div>}
                </TD>
                <TD className="text-slate-300">{a.segment ?? '—'}</TD>
                <TD className="text-slate-300">{a.industry ?? '—'}</TD>
                <TD className="text-slate-300">{a.region ?? '—'}</TD>
                <TD className="text-slate-300">{a.csm_owner ?? '—'}</TD>
                <TD>
                  {a.plan_tier ? (
                    <Badge tone={PLAN_TONE[a.plan_tier.toLowerCase()] ?? 'slate'}>{a.plan_tier}</Badge>
                  ) : (
                    <span className="text-slate-600">—</span>
                  )}
                </TD>
                <TD className="text-right font-semibold text-emerald-300">{fmtMoney(a.current_arr_cents)}</TD>
                <TD className="text-right">
                  <div className="flex justify-end gap-2">
                    <Link href={`/dashboard/accounts/${a.id}`}>
                      <Button variant="ghost" size="sm">
                        Open
                      </Button>
                    </Link>
                    <Button variant="danger" size="sm" onClick={() => setToDelete(a)}>
                      Delete
                    </Button>
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {/* Create modal */}
      <Modal
        open={createOpen}
        onClose={() => {
          setCreateOpen(false)
          setFormError(null)
        }}
        title="New account"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setCreateOpen(false)
                setFormError(null)
              }}
            >
              Cancel
            </Button>
            <Button onClick={create} disabled={saving}>
              {saving ? 'Creating...' : 'Create account'}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          {formError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-300">{formError}</div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name *" value={form.name} onChange={(v) => setField('name', v)} placeholder="Acme Corp" />
            <Field
              label="External ID"
              value={form.external_id}
              onChange={(v) => setField('external_id', v)}
              placeholder="CRM-1234"
            />
            <Field label="Segment" value={form.segment} onChange={(v) => setField('segment', v)} placeholder="Enterprise" />
            <Field label="Industry" value={form.industry} onChange={(v) => setField('industry', v)} placeholder="SaaS" />
            <Field label="Region" value={form.region} onChange={(v) => setField('region', v)} placeholder="NA" />
            <Field
              label="Employee band"
              value={form.employee_band}
              onChange={(v) => setField('employee_band', v)}
              placeholder="1000-5000"
            />
            <Field label="Plan tier" value={form.plan_tier} onChange={(v) => setField('plan_tier', v)} placeholder="pro" />
            <Field label="CSM owner" value={form.csm_owner} onChange={(v) => setField('csm_owner', v)} placeholder="Jane Doe" />
            <Field
              label="Current ARR ($)"
              type="number"
              value={form.current_arr}
              onChange={(v) => setField('current_arr', v)}
              placeholder="120000"
            />
          </div>
        </div>
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        title="Delete account"
        footer={
          <>
            <Button variant="secondary" onClick={() => setToDelete(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDelete} disabled={deleting}>
              {deleting ? 'Deleting...' : 'Delete'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-300">
          Permanently delete <span className="font-semibold text-white">{toDelete?.name}</span> and its ownership,
          seats, sizing, and plays? This cannot be undone.
        </p>
      </Modal>
    </div>
  )
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: string[]
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-slate-500">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-brand-500 focus:outline-none"
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-slate-500">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-600 focus:border-brand-500 focus:outline-none"
      />
    </div>
  )
}
