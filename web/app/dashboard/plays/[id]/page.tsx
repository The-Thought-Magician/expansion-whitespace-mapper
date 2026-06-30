'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'

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
  created_by?: string
  created_at?: string
  updated_at?: string
}

interface Activity {
  id: string
  activity_type: string
  from_stage?: string | null
  to_stage?: string | null
  body?: string | null
  created_by?: string
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

function fmtMoney(cents?: number | null): string {
  if (cents == null) return '$0'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100)
}

function fmtTime(s?: string): string {
  if (!s) return ''
  const d = new Date(s)
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export default function PlayDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id

  const [play, setPlay] = useState<Play | null>(null)
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [edit, setEdit] = useState({ open_arr_cents: '', owner: '', due_date: '', notes: '' })
  const [note, setNote] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)

  async function load() {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const res = await api.getPlay(id)
      const p: Play = res?.play ?? res
      setPlay(p)
      setActivities(Array.isArray(res?.activities) ? res.activities : [])
      if (p) {
        setEdit({
          open_arr_cents: p.open_arr_cents != null ? String(p.open_arr_cents / 100) : '',
          owner: p.owner ?? '',
          due_date: p.due_date ? p.due_date.slice(0, 10) : '',
          notes: p.notes ?? '',
        })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load play')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function transition(stage: Stage) {
    if (!play || stage === play.stage) return
    setBusy(true)
    setActionError(null)
    try {
      await api.transitionPlay(play.id, stage)
      await load()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to transition stage')
    } finally {
      setBusy(false)
    }
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!play) return
    setBusy(true)
    setActionError(null)
    try {
      await api.updatePlay(play.id, {
        open_arr_cents: Math.round((Number(edit.open_arr_cents) || 0) * 100),
        owner: edit.owner.trim() || null,
        due_date: edit.due_date || null,
        notes: edit.notes.trim() || null,
      })
      setEditing(false)
      await load()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to update play')
    } finally {
      setBusy(false)
    }
  }

  async function addNote(e: React.FormEvent) {
    e.preventDefault()
    if (!play || !note.trim()) return
    setBusy(true)
    setActionError(null)
    try {
      await api.addPlayActivity(play.id, { activity_type: 'note', body: note.trim() })
      setNote('')
      await load()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to add note')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <PageSpinner label="Loading play…" />

  if (error || !play) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/plays" className="text-sm text-purple-400 hover:text-purple-300">← Back to play queue</Link>
        <EmptyState
          title="Play not found"
          description={error ?? 'This play may have been deleted.'}
          action={<Button onClick={load}>Retry</Button>}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/dashboard/plays" className="text-sm text-purple-400 hover:text-purple-300">← Play queue</Link>
          <h1 className="mt-2 flex items-center gap-3 text-2xl font-bold text-white">
            {play.account_name ?? play.account_id}
            <Badge tone={STAGE_TONE[play.stage]}>{STAGE_LABELS[play.stage] ?? play.stage}</Badge>
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            {play.product_name ?? play.product_id} · <span className="uppercase tracking-wide">{play.play_type.replace(/_/g, ' ')}</span>
          </p>
        </div>
        <Button variant="secondary" onClick={() => setEditing((v) => !v)}>{editing ? 'Cancel edit' : 'Edit play'}</Button>
      </div>

      {actionError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{actionError}</div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Open ARR" value={fmtMoney(play.open_arr_cents)} tone="purple" />
        <Stat label="Owner" value={play.owner || '—'} />
        <Stat label="Due" value={play.due_date ? new Date(play.due_date).toLocaleDateString() : '—'} />
        <Stat label="Created" value={play.created_at ? new Date(play.created_at).toLocaleDateString() : '—'} />
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-white">Stage</h2>
        </CardHeader>
        <CardBody>
          <div className="flex flex-wrap items-center gap-2">
            {STAGES.map((s, i) => {
              const isCurrent = s === play.stage
              return (
                <div key={s} className="flex items-center gap-2">
                  <button
                    onClick={() => transition(s)}
                    disabled={busy || isCurrent}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                      isCurrent
                        ? 'bg-purple-600 text-white'
                        : 'border border-slate-700 bg-slate-900 text-slate-300 hover:border-purple-500/50 hover:text-white disabled:opacity-50'
                    }`}
                  >
                    {STAGE_LABELS[s]}
                  </button>
                  {i < STAGES.length - 1 && <span className="text-slate-600">→</span>}
                </div>
              )
            })}
          </div>
          <p className="mt-3 text-xs text-slate-500">Changing the stage logs a transition activity below.</p>
        </CardBody>
      </Card>

      {editing && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-white">Edit play</h2>
          </CardHeader>
          <CardBody>
            <form onSubmit={saveEdit} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-400">Open ARR ($)</span>
                  <input
                    type="number"
                    value={edit.open_arr_cents}
                    onChange={(e) => setEdit({ ...edit, open_arr_cents: e.target.value })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-purple-500 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-400">Owner</span>
                  <input
                    value={edit.owner}
                    onChange={(e) => setEdit({ ...edit, owner: e.target.value })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-purple-500 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-400">Due date</span>
                  <input
                    type="date"
                    value={edit.due_date}
                    onChange={(e) => setEdit({ ...edit, due_date: e.target.value })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-purple-500 focus:outline-none"
                  />
                </label>
              </div>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-400">Notes</span>
                <textarea
                  value={edit.notes}
                  onChange={(e) => setEdit({ ...edit, notes: e.target.value })}
                  rows={3}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-purple-500 focus:outline-none"
                />
              </label>
              <div className="flex justify-end gap-3">
                <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
                <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      {!editing && play.notes && (
        <Card>
          <CardHeader><h2 className="text-sm font-semibold text-white">Notes</h2></CardHeader>
          <CardBody><p className="whitespace-pre-wrap text-sm text-slate-300">{play.notes}</p></CardBody>
        </Card>
      )}

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-white">Activity log</h2>
        </CardHeader>
        <CardBody className="space-y-5">
          <form onSubmit={addNote} className="flex flex-col gap-2 sm:flex-row">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Log a note or update…"
              className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-purple-500 focus:outline-none"
            />
            <Button type="submit" disabled={busy || !note.trim()}>Add note</Button>
          </form>

          {activities.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-500">No activity yet. Stage changes and notes will appear here.</p>
          ) : (
            <ol className="relative space-y-4 border-l border-slate-800 pl-5">
              {activities.map((a) => (
                <li key={a.id} className="relative">
                  <span className="absolute -left-[1.42rem] top-1 h-2.5 w-2.5 rounded-full border-2 border-slate-950 bg-purple-500" />
                  <div className="flex flex-wrap items-center gap-2">
                    {a.activity_type === 'stage_change' || (a.from_stage || a.to_stage) ? (
                      <span className="text-sm text-slate-300">
                        Stage{' '}
                        {a.from_stage && <Badge tone={STAGE_TONE[a.from_stage] ?? 'slate'}>{STAGE_LABELS[a.from_stage] ?? a.from_stage}</Badge>}
                        {a.from_stage && a.to_stage && <span className="mx-1 text-slate-600">→</span>}
                        {a.to_stage && <Badge tone={STAGE_TONE[a.to_stage] ?? 'slate'}>{STAGE_LABELS[a.to_stage] ?? a.to_stage}</Badge>}
                      </span>
                    ) : (
                      <Badge tone="slate">{(a.activity_type || 'note').replace(/_/g, ' ')}</Badge>
                    )}
                    <span className="text-xs text-slate-500">{fmtTime(a.created_at)}</span>
                    {a.created_by && <span className="text-xs text-slate-600">· {a.created_by}</span>}
                  </div>
                  {a.body && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-400">{a.body}</p>}
                </li>
              ))}
            </ol>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
