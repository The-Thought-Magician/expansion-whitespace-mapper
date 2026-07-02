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

interface Notification {
  id: string
  kind: string
  title: string
  body?: string
  link?: string
  is_read: boolean
  created_at?: string
}

interface TriggerRule {
  id: string
  name: string
  event_type: string
  conditions?: Record<string, unknown>
  is_active: boolean
  created_at?: string
}

const EVENT_TYPES: { value: string; label: string }[] = [
  { value: 'whitespace_sized', label: 'Whitespace sized above threshold' },
  { value: 'seat_overage', label: 'Seat overage detected' },
  { value: 'lookalike_found', label: 'New look-alike suggestion' },
  { value: 'play_stalled', label: 'Play stalled in stage' },
  { value: 'play_won', label: 'Play won' },
  { value: 'target_at_risk', label: 'Target attainment at risk' },
]

function kindTone(kind: string): 'purple' | 'green' | 'amber' | 'red' | 'blue' | 'slate' {
  switch (kind?.toLowerCase()) {
    case 'whitespace_sized':
    case 'whitespace': return 'purple'
    case 'play_won':
    case 'success': return 'green'
    case 'seat_overage':
    case 'play_stalled':
    case 'target_at_risk':
    case 'warning': return 'amber'
    case 'error':
    case 'alert': return 'red'
    case 'lookalike_found':
    case 'info': return 'blue'
    default: return 'slate'
  }
}

function timeAgo(s?: string): string {
  if (!s) return ''
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return ''
  const diff = Date.now() - d.getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.floor(h / 24)
  if (days < 30) return `${days}d ago`
  return d.toLocaleDateString()
}

const EMPTY_TRIGGER = { name: '', event_type: EVENT_TYPES[0].value, conditions: '' }

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [triggers, setTriggers] = useState<TriggerRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [tab, setTab] = useState<'feed' | 'triggers'>('feed')
  const [feedFilter, setFeedFilter] = useState<'all' | 'unread'>('all')
  const [busy, setBusy] = useState(false)

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_TRIGGER)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [n, t] = await Promise.all([api.listNotifications(), api.listTriggers()])
      setNotifications(Array.isArray(n) ? n : [])
      setTriggers(Array.isArray(t) ? t : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load notifications')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const unreadCount = useMemo(() => notifications.filter((n) => !n.is_read).length, [notifications])
  const visibleFeed = useMemo(
    () => (feedFilter === 'unread' ? notifications.filter((n) => !n.is_read) : notifications),
    [notifications, feedFilter],
  )

  async function markRead(id: string) {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)))
    try {
      await api.markNotificationRead(id)
    } catch {
      await load()
    }
  }

  async function markAll() {
    if (unreadCount === 0) return
    setBusy(true)
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })))
    try {
      await api.markAllNotificationsRead()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark all read')
      await load()
    } finally {
      setBusy(false)
    }
  }

  function openCreate() {
    setForm(EMPTY_TRIGGER)
    setFormError(null)
    setOpen(true)
  }

  async function submitTrigger(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setFormError(null)
    let conditions: unknown = {}
    if (form.conditions.trim()) {
      try {
        conditions = JSON.parse(form.conditions)
      } catch {
        setFormError('Conditions must be valid JSON, e.g. {"min_arr_cents": 1000000}')
        setSaving(false)
        return
      }
    }
    try {
      await api.createTrigger({ name: form.name.trim(), event_type: form.event_type, conditions, is_active: true })
      setOpen(false)
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create trigger rule')
    } finally {
      setSaving(false)
    }
  }

  async function removeTrigger(id: string) {
    if (!confirm('Delete this trigger rule?')) return
    const prev = triggers
    setTriggers((t) => t.filter((x) => x.id !== id))
    try {
      await api.deleteTrigger(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete trigger')
      setTriggers(prev)
    }
  }

  if (loading) return <PageSpinner label="Loading notifications…" />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Notifications</h1>
          <p className="mt-1 text-sm text-slate-400">
            Expansion signals delivered to your feed, plus the trigger rules that generate them.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={load}>Refresh</Button>
          {tab === 'feed' ? (
            <Button onClick={markAll} disabled={busy || unreadCount === 0}>
              {busy ? 'Marking…' : `Mark all read${unreadCount ? ` (${unreadCount})` : ''}`}
            </Button>
          ) : (
            <Button onClick={openCreate}>+ Trigger rule</Button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error} <button className="ml-2 underline" onClick={load}>Retry</button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Total notifications" value={notifications.length.toLocaleString()} />
        <Stat label="Unread" value={unreadCount} tone={unreadCount ? 'amber' : 'green'} />
        <Stat label="Trigger rules" value={triggers.length} tone="purple" />
        <Stat label="Active rules" value={triggers.filter((t) => t.is_active).length} tone="green" />
      </div>

      <div className="flex gap-1 border-b border-slate-800">
        {(['feed', 'triggers'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === t ? 'border-brand-500 text-white' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {t === 'feed' ? `Feed (${notifications.length})` : `Trigger rules (${triggers.length})`}
          </button>
        ))}
      </div>

      {tab === 'feed' ? (
        <Card>
          <CardHeader className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-1">
              {([
                ['all', `All (${notifications.length})`],
                ['unread', `Unread (${unreadCount})`],
              ] as const).map(([v, l]) => (
                <button
                  key={v}
                  onClick={() => setFeedFilter(v)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                    feedFilter === v ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardBody className="p-0">
            {visibleFeed.length === 0 ? (
              <EmptyState
                title={notifications.length === 0 ? 'No notifications yet' : 'All caught up'}
                description={
                  notifications.length === 0
                    ? 'Create trigger rules to start receiving expansion signals here.'
                    : 'No unread notifications. Switch to All to review past signals.'
                }
              />
            ) : (
              <ul className="divide-y divide-slate-800">
                {visibleFeed.map((n) => (
                  <li
                    key={n.id}
                    className={`flex items-start gap-3 px-5 py-4 ${n.is_read ? '' : 'bg-brand-500/5'}`}
                  >
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.is_read ? 'bg-slate-700' : 'bg-brand-500'}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-white">{n.title}</span>
                        <Badge tone={kindTone(n.kind)}>{n.kind}</Badge>
                        <span className="text-xs text-slate-500">{timeAgo(n.created_at)}</span>
                      </div>
                      {n.body && <p className="mt-1 text-sm text-slate-400">{n.body}</p>}
                      {n.link && (
                        <a href={n.link} className="mt-1 inline-block text-xs font-medium text-brand-400 hover:text-brand-300">
                          View detail →
                        </a>
                      )}
                    </div>
                    {!n.is_read && (
                      <Button size="sm" variant="ghost" onClick={() => markRead(n.id)}>Mark read</Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-white">Trigger rules</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Rules that watch expansion events and write a notification when their conditions match.
            </p>
          </CardHeader>
          <CardBody className="p-0">
            {triggers.length === 0 ? (
              <EmptyState
                title="No trigger rules"
                description="Add a rule, e.g. notify when a whitespace cell is sized above a threshold."
                action={<Button onClick={openCreate}>+ Trigger rule</Button>}
              />
            ) : (
              <ul className="divide-y divide-slate-800">
                {triggers.map((t) => {
                  const label = EVENT_TYPES.find((e) => e.value === t.event_type)?.label ?? t.event_type
                  const condStr = t.conditions && Object.keys(t.conditions).length ? JSON.stringify(t.conditions) : null
                  return (
                    <li key={t.id} className="flex items-start justify-between gap-4 px-5 py-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-white">{t.name}</span>
                          <Badge tone={t.is_active ? 'green' : 'slate'}>{t.is_active ? 'active' : 'inactive'}</Badge>
                        </div>
                        <p className="mt-1 text-sm text-slate-400">{label}</p>
                        {condStr && (
                          <code className="mt-1 inline-block rounded bg-slate-800 px-1.5 py-0.5 text-xs text-brand-300">{condStr}</code>
                        )}
                      </div>
                      <Button size="sm" variant="danger" onClick={() => removeTrigger(t.id)}>Delete</Button>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardBody>
        </Card>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New trigger rule"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" form="trigger-form" disabled={saving}>{saving ? 'Creating…' : 'Create rule'}</Button>
          </>
        }
      >
        <form id="trigger-form" onSubmit={submitTrigger} className="space-y-4">
          {formError && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{formError}</p>}
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-400">Rule name <span className="text-red-400">*</span></span>
            <input
              value={form.name}
              required
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="High-value whitespace alert"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-400">Event type</span>
            <select
              value={form.event_type}
              onChange={(e) => setForm({ ...form, event_type: e.target.value })}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-brand-500 focus:outline-none"
            >
              {EVENT_TYPES.map((e) => (
                <option key={e.value} value={e.value}>{e.label}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-400">Conditions (JSON, optional)</span>
            <textarea
              value={form.conditions}
              onChange={(e) => setForm({ ...form, conditions: e.target.value })}
              rows={4}
              placeholder={'{"min_arr_cents": 1000000}'}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-200 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none"
            />
            <span className="mt-1 block text-xs text-slate-500">Leave empty to fire on every matching event.</span>
          </label>
        </form>
      </Modal>
    </div>
  )
}
