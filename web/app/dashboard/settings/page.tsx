'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { Stat } from '@/components/ui/Stat'
import { PageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { Modal } from '@/components/ui/Modal'

type OrgSettings = {
  id?: string
  default_currency?: string | null
  default_sizing_method?: string | null
  default_term?: string | null
  settings?: any
  updated_at?: string | null
}

type Plan = {
  id?: string
  name?: string | null
  price_cents?: number | null
}

type Subscription = {
  id?: string
  plan_id?: string | null
  status?: string | null
  current_period_end?: string | null
  stripe_customer_id?: string | null
}

type BillingPlan = {
  subscription?: Subscription | null
  plan?: Plan | null
  stripeEnabled?: boolean
}

type SavedView = {
  id: string
  name?: string | null
  surface?: string | null
  filters?: any
  is_shared?: boolean | null
  created_at?: string | null
}

type AuditEntry = {
  id: string
  entity?: string | null
  entity_id?: string | null
  action?: string | null
  detail?: any
  created_at?: string | null
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY']
const SIZING_METHODS = ['list_price', 'per_seat', 'peer_median', 'manual']
const TERMS = ['monthly', 'annual', 'multi_year']

function fmtPrice(cents?: number | null): string {
  if (cents == null) return '—'
  if (cents === 0) return 'Free'
  return `$${(cents / 100).toFixed(2)}`
}

function fmtDateTime(s?: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function fmtDate(s?: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function actionTone(action?: string | null): 'green' | 'amber' | 'red' | 'blue' | 'slate' {
  const a = (action ?? '').toLowerCase()
  if (a.includes('create') || a.includes('add')) return 'green'
  if (a.includes('update') || a.includes('edit')) return 'amber'
  if (a.includes('delete') || a.includes('remove') || a.includes('reset')) return 'red'
  if (a.includes('apply') || a.includes('compute') || a.includes('generate')) return 'blue'
  return 'slate'
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<OrgSettings | null>(null)
  const [billing, setBilling] = useState<BillingPlan | null>(null)
  const [views, setViews] = useState<SavedView[] | null>(null)
  const [audit, setAudit] = useState<AuditEntry[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // settings form
  const [form, setForm] = useState<OrgSettings>({})
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsMsg, setSettingsMsg] = useState<string | null>(null)

  // billing actions
  const [billingBusy, setBillingBusy] = useState(false)
  const [billingMsg, setBillingMsg] = useState<string | null>(null)

  // saved view delete
  const [deletingView, setDeletingView] = useState<SavedView | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  // audit filter
  const [auditEntity, setAuditEntity] = useState('')

  // reset sample data
  const [resetOpen, setResetOpen] = useState(false)
  const [resetBusy, setResetBusy] = useState(false)
  const [resetMsg, setResetMsg] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [s, b, v, a] = await Promise.all([
        api.getSettings(),
        api.getBillingPlan(),
        api.listSavedViews(),
        api.listAudit(),
      ])
      const sv = (s ?? {}) as OrgSettings
      setSettings(sv)
      setForm({
        default_currency: sv.default_currency ?? 'USD',
        default_sizing_method: sv.default_sizing_method ?? 'list_price',
        default_term: sv.default_term ?? 'annual',
      })
      setBilling((b ?? {}) as BillingPlan)
      setViews(Array.isArray(v) ? (v as SavedView[]) : [])
      setAudit(Array.isArray(a) ? (a as AuditEntry[]) : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function reloadAudit(entity: string) {
    try {
      const a = await api.listAudit(entity ? { entity } : undefined)
      setAudit(Array.isArray(a) ? (a as AuditEntry[]) : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit log')
    }
  }

  async function handleSaveSettings() {
    setSavingSettings(true)
    setSettingsMsg(null)
    try {
      const updated = (await api.updateSettings({
        default_currency: form.default_currency,
        default_sizing_method: form.default_sizing_method,
        default_term: form.default_term,
      })) as OrgSettings
      setSettings(updated)
      setSettingsMsg('Saved.')
    } catch (err) {
      setSettingsMsg(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setSavingSettings(false)
    }
  }

  async function handleCheckout() {
    setBillingBusy(true)
    setBillingMsg(null)
    try {
      const res = (await api.startCheckout()) as { url?: string }
      if (res?.url) {
        window.location.href = res.url
      } else {
        setBillingMsg('Checkout is not available.')
      }
    } catch (err) {
      setBillingMsg(err instanceof Error ? err.message : 'Billing is not configured.')
    } finally {
      setBillingBusy(false)
    }
  }

  async function handlePortal() {
    setBillingBusy(true)
    setBillingMsg(null)
    try {
      const res = (await api.openBillingPortal()) as { url?: string }
      if (res?.url) {
        window.location.href = res.url
      } else {
        setBillingMsg('Billing portal is not available.')
      }
    } catch (err) {
      setBillingMsg(err instanceof Error ? err.message : 'Billing is not configured.')
    } finally {
      setBillingBusy(false)
    }
  }

  async function handleDeleteView() {
    if (!deletingView) return
    setDeleteBusy(true)
    try {
      await api.deleteSavedView(deletingView.id)
      setViews((prev) => (prev ?? []).filter((v) => v.id !== deletingView.id))
      setDeletingView(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete saved view')
    } finally {
      setDeleteBusy(false)
    }
  }

  async function handleReset() {
    setResetBusy(true)
    setResetMsg(null)
    try {
      await api.resetSampleData()
      setResetOpen(false)
      setResetMsg('Sample data reset complete.')
      await load()
    } catch (err) {
      setResetMsg(err instanceof Error ? err.message : 'Failed to reset sample data')
    } finally {
      setResetBusy(false)
    }
  }

  const stripeEnabled = billing?.stripeEnabled ?? false
  const planName = billing?.plan?.name ?? billing?.subscription?.plan_id ?? 'Free'
  const subStatus = billing?.subscription?.status ?? 'active'

  const auditEntities = useMemo(() => {
    const set = new Set<string>()
    for (const e of audit ?? []) if (e.entity) set.add(e.entity)
    return Array.from(set).sort()
  }, [audit])

  if (loading) return <PageSpinner label="Loading settings..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Settings</h1>
          <p className="mt-1 text-sm text-slate-400">
            Org defaults, billing, saved views, and the audit trail for your workspace.
          </p>
        </div>
        <Button variant="secondary" onClick={load}>
          Refresh
        </Button>
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

      {/* Org settings */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-white">Org Defaults</h2>
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Default Currency
              </span>
              <select
                value={form.default_currency ?? 'USD'}
                onChange={(e) => setForm({ ...form, default_currency: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-brand-500 focus:outline-none"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Default Sizing Method
              </span>
              <select
                value={form.default_sizing_method ?? 'list_price'}
                onChange={(e) => setForm({ ...form, default_sizing_method: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-brand-500 focus:outline-none"
              >
                {SIZING_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Default Term
              </span>
              <select
                value={form.default_term ?? 'annual'}
                onChange={(e) => setForm({ ...form, default_term: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-brand-500 focus:outline-none"
              >
                {TERMS.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Button onClick={handleSaveSettings} disabled={savingSettings}>
              {savingSettings ? 'Saving...' : 'Save defaults'}
            </Button>
            {settingsMsg && (
              <span
                className={`text-sm ${
                  settingsMsg === 'Saved.' ? 'text-emerald-300' : 'text-red-300'
                }`}
              >
                {settingsMsg}
              </span>
            )}
            {settings?.updated_at && (
              <span className="text-xs text-slate-500">
                Last updated {fmtDateTime(settings.updated_at)}
              </span>
            )}
          </div>
        </CardBody>
      </Card>

      {/* Billing */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-white">Billing</h2>
            {stripeEnabled ? (
              <Badge tone="green">Stripe connected</Badge>
            ) : (
              <Badge tone="slate">Stripe not configured</Badge>
            )}
          </div>
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Stat label="Current Plan" value={planName} tone="purple" />
            <Stat label="Status" value={subStatus} />
            <Stat
              label="Price"
              value={fmtPrice(billing?.plan?.price_cents)}
              hint={
                billing?.subscription?.current_period_end
                  ? `Renews ${fmtDate(billing.subscription.current_period_end)}`
                  : 'All features are free'
              }
            />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button onClick={handleCheckout} disabled={billingBusy || !stripeEnabled}>
              {billingBusy ? 'Working...' : 'Upgrade plan'}
            </Button>
            <Button
              variant="secondary"
              onClick={handlePortal}
              disabled={billingBusy || !stripeEnabled}
            >
              Manage billing
            </Button>
            {!stripeEnabled && (
              <span className="text-xs text-slate-500">
                Every feature is available on the free plan. Stripe is optional.
              </span>
            )}
            {billingMsg && <span className="text-sm text-amber-300">{billingMsg}</span>}
          </div>
        </CardBody>
      </Card>

      {/* Saved views */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-white">Saved Views</h2>
            <span className="text-xs text-slate-500">{(views ?? []).length} total</span>
          </div>
        </CardHeader>
        <CardBody>
          {!views || views.length === 0 ? (
            <EmptyState
              title="No saved views"
              description="Save a filtered grid or list view from any surface to pin it here."
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Surface</TH>
                  <TH>Shared</TH>
                  <TH>Created</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {views.map((v) => (
                  <TR key={v.id}>
                    <TD className="font-medium text-white">{v.name ?? 'Untitled'}</TD>
                    <TD>
                      <Badge tone="blue">{v.surface ?? '—'}</Badge>
                    </TD>
                    <TD>
                      {v.is_shared ? (
                        <Badge tone="purple">Shared</Badge>
                      ) : (
                        <span className="text-slate-500">Private</span>
                      )}
                    </TD>
                    <TD className="text-slate-400">{fmtDate(v.created_at)}</TD>
                    <TD className="text-right">
                      <Button variant="danger" size="sm" onClick={() => setDeletingView(v)}>
                        Delete
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Audit log */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-white">Audit Log</h2>
            <select
              value={auditEntity}
              onChange={(e) => {
                setAuditEntity(e.target.value)
                reloadAudit(e.target.value)
              }}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 focus:border-brand-500 focus:outline-none"
            >
              <option value="">All entities</option>
              {auditEntities.map((en) => (
                <option key={en} value={en}>
                  {en}
                </option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardBody>
          {!audit || audit.length === 0 ? (
            <EmptyState
              title="No audit entries"
              description={
                auditEntity
                  ? `No activity recorded for "${auditEntity}".`
                  : 'Write actions across the workspace will appear here.'
              }
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>When</TH>
                  <TH>Action</TH>
                  <TH>Entity</TH>
                  <TH>Detail</TH>
                </TR>
              </THead>
              <TBody>
                {audit.map((e) => (
                  <TR key={e.id}>
                    <TD className="whitespace-nowrap text-slate-400">{fmtDateTime(e.created_at)}</TD>
                    <TD>
                      <Badge tone={actionTone(e.action)}>{e.action ?? '—'}</Badge>
                    </TD>
                    <TD className="text-slate-300">
                      {e.entity ?? '—'}
                      {e.entity_id && (
                        <span className="ml-1 text-xs text-slate-600">
                          #{String(e.entity_id).slice(0, 8)}
                        </span>
                      )}
                    </TD>
                    <TD className="max-w-xs truncate text-xs text-slate-500">
                      {e.detail
                        ? typeof e.detail === 'string'
                          ? e.detail
                          : JSON.stringify(e.detail)
                        : '—'}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Danger zone */}
      <Card className="border-red-500/30">
        <CardHeader className="border-red-500/20">
          <h2 className="text-sm font-semibold text-red-300">Danger Zone</h2>
        </CardHeader>
        <CardBody>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-slate-200">Reset sample data</p>
              <p className="mt-0.5 text-xs text-slate-500">
                Wipes all of your accounts, catalog, plays, and computed whitespace, then reseeds a
                fresh sample dataset. This cannot be undone.
              </p>
            </div>
            <Button variant="danger" onClick={() => { setResetOpen(true); setResetMsg(null) }}>
              Reset data
            </Button>
          </div>
          {resetMsg && (
            <p
              className={`mt-3 text-sm ${
                resetMsg.includes('complete') ? 'text-emerald-300' : 'text-red-300'
              }`}
            >
              {resetMsg}
            </p>
          )}
        </CardBody>
      </Card>

      {/* Delete saved view modal */}
      <Modal
        open={!!deletingView}
        onClose={() => { if (!deleteBusy) setDeletingView(null) }}
        title="Delete saved view"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeletingView(null)} disabled={deleteBusy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDeleteView} disabled={deleteBusy}>
              {deleteBusy ? 'Deleting...' : 'Delete'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-400">
          Delete the saved view <span className="font-medium text-white">{deletingView?.name}</span>?
          This only removes the pinned view, not the underlying data.
        </p>
      </Modal>

      {/* Reset confirm modal */}
      <Modal
        open={resetOpen}
        onClose={() => { if (!resetBusy) setResetOpen(false) }}
        title="Reset sample data"
        footer={
          <>
            <Button variant="ghost" onClick={() => setResetOpen(false)} disabled={resetBusy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleReset} disabled={resetBusy}>
              {resetBusy ? 'Resetting...' : 'Wipe and reseed'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-400">
          This permanently deletes all of your current workspace data and replaces it with a fresh
          sample dataset. There is no undo.
        </p>
      </Modal>
    </div>
  )
}
