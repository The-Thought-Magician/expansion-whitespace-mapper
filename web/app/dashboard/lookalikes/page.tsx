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

interface Suggestion {
  id: string
  account_id?: string
  account_name?: string
  product_id?: string
  product_name?: string
  segment?: string | null
  adoption_rate?: number | null
  peer_count?: number | null
  open_arr_cents?: number | null
  score?: number | null
  explanation?: string | null
  computed_at?: string
}

function fmtUsd(cents?: number | null): string {
  const n = (cents ?? 0) / 100
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}

function fmtUsdFull(cents?: number | null): string {
  return `$${((cents ?? 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function pct(v?: number | null): string {
  if (v == null) return '—'
  return `${Math.round(v * 100)}%`
}

function scoreTone(s?: number | null): 'green' | 'amber' | 'slate' {
  if (s == null) return 'slate'
  if (s >= 0.7) return 'green'
  if (s >= 0.4) return 'amber'
  return 'slate'
}

const PLAY_STAGES = ['queued', 'qualifying', 'engaged', 'committed', 'closed_won', 'closed_lost']

export default function LookalikesPage() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [segmentFilter, setSegmentFilter] = useState('')
  const [minAdoption, setMinAdoption] = useState(0)
  const [minArr, setMinArr] = useState(0)
  const [sortBy, setSortBy] = useState<'score' | 'arr' | 'adoption'>('score')

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [computing, setComputing] = useState(false)
  const [computeMsg, setComputeMsg] = useState('')

  const [playModal, setPlayModal] = useState<{ targets: Suggestion[] } | null>(null)
  const [playForm, setPlayForm] = useState({ play_type: 'cross_sell', stage: 'queued', owner: '', notes: '' })
  const [creatingPlay, setCreatingPlay] = useState(false)
  const [playError, setPlayError] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const s = await api.listLookalikes()
      setSuggestions(Array.isArray(s) ? s : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load look-alike suggestions')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const segments = useMemo(() => {
    const set = new Set<string>()
    for (const s of suggestions) if (s.segment) set.add(s.segment)
    return Array.from(set).sort()
  }, [suggestions])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = suggestions.filter((s) => {
      if (segmentFilter && s.segment !== segmentFilter) return false
      if (minAdoption > 0 && (s.adoption_rate ?? 0) < minAdoption / 100) return false
      if (minArr > 0 && (s.open_arr_cents ?? 0) < minArr * 100) return false
      if (!q) return true
      return (
        (s.account_name ?? '').toLowerCase().includes(q) ||
        (s.product_name ?? '').toLowerCase().includes(q) ||
        (s.explanation ?? '').toLowerCase().includes(q)
      )
    })
    list = [...list].sort((a, b) => {
      if (sortBy === 'arr') return (b.open_arr_cents ?? 0) - (a.open_arr_cents ?? 0)
      if (sortBy === 'adoption') return (b.adoption_rate ?? 0) - (a.adoption_rate ?? 0)
      return (b.score ?? 0) - (a.score ?? 0)
    })
    return list
  }, [suggestions, search, segmentFilter, minAdoption, minArr, sortBy])

  const totalArr = useMemo(
    () => suggestions.reduce((acc, s) => acc + (s.open_arr_cents ?? 0), 0),
    [suggestions],
  )
  const avgAdoption = useMemo(() => {
    if (suggestions.length === 0) return 0
    return suggestions.reduce((acc, s) => acc + (s.adoption_rate ?? 0), 0) / suggestions.length
  }, [suggestions])

  async function recompute() {
    setComputeMsg('')
    setComputing(true)
    try {
      const res = await api.computeLookalikes()
      const n = Array.isArray(res?.suggestions) ? res.suggestions.length : res?.suggestions ?? 0
      setComputeMsg(`Recomputed adoption-based suggestions${typeof n === 'number' ? ` — ${n} found` : ''}.`)
      await load()
      setSelected(new Set())
    } catch (e) {
      setComputeMsg(e instanceof Error ? e.message : 'Recompute failed')
    } finally {
      setComputing(false)
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selected.size === filtered.length) setSelected(new Set())
    else setSelected(new Set(filtered.map((s) => s.id)))
  }

  function openQueueSingle(s: Suggestion) {
    setPlayForm({ play_type: 'cross_sell', stage: 'queued', owner: '', notes: '' })
    setPlayError('')
    setPlayModal({ targets: [s] })
  }

  function openQueueSelected() {
    const targets = filtered.filter((s) => selected.has(s.id))
    if (targets.length === 0) return
    setPlayForm({ play_type: 'cross_sell', stage: 'queued', owner: '', notes: '' })
    setPlayError('')
    setPlayModal({ targets })
  }

  async function createPlays() {
    if (!playModal) return
    setPlayError('')
    setCreatingPlay(true)
    try {
      for (const s of playModal.targets) {
        await api.createPlay({
          account_id: s.account_id,
          product_id: s.product_id,
          play_type: playForm.play_type,
          stage: playForm.stage,
          owner: playForm.owner.trim() || null,
          open_arr_cents: s.open_arr_cents ?? 0,
          notes:
            playForm.notes.trim() ||
            (s.explanation ? `Look-alike: ${s.explanation}` : 'From look-alike suggestion'),
        })
      }
      setPlayModal(null)
      setSelected(new Set())
      setComputeMsg(`Added ${playModal.targets.length} play${playModal.targets.length === 1 ? '' : 's'} to the queue.`)
    } catch (e) {
      setPlayError(e instanceof Error ? e.message : 'Failed to create plays')
    } finally {
      setCreatingPlay(false)
    }
  }

  if (loading) return <PageSpinner label="Loading look-alike suggestions..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Look-Alike Suggestions</h1>
          <p className="mt-1 text-sm text-slate-400">
            Accounts that resemble high-adopting peers but have not yet bought the product. Queue the best as expansion plays.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <Button variant="secondary" onClick={openQueueSelected}>
              Queue {selected.size} as plays
            </Button>
          )}
          <Button onClick={recompute} disabled={computing}>
            {computing ? 'Computing...' : 'Recompute suggestions'}
          </Button>
        </div>
      </div>

      {computeMsg && (
        <div className="rounded-lg border border-purple-500/30 bg-purple-500/10 px-4 py-3 text-sm text-purple-200">
          {computeMsg}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-700 bg-red-900/30 px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Suggestions" value={suggestions.length} tone="purple" />
        <Stat label="Total open ARR" value={fmtUsd(totalArr)} tone="green" hint={fmtUsdFull(totalArr)} />
        <Stat label="Avg peer adoption" value={pct(avgAdoption)} />
        <Stat label="Segments covered" value={segments.length} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search account, product, reason..."
              className="w-full max-w-xs rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-purple-500 focus:outline-none"
            />
            <select
              value={segmentFilter}
              onChange={(e) => setSegmentFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none"
            >
              <option value="">All segments</option>
              {segments.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none"
            >
              <option value="score">Sort by score</option>
              <option value="arr">Sort by ARR</option>
              <option value="adoption">Sort by adoption</option>
            </select>
          </div>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <label className="flex items-center gap-2 text-xs text-slate-400">
              Min adoption {minAdoption}%
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={minAdoption}
                onChange={(e) => setMinAdoption(Number(e.target.value))}
                className="accent-purple-500"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-400">
              Min open ARR $
              <input
                type="number"
                min={0}
                step={1000}
                value={minArr}
                onChange={(e) => setMinArr(Number(e.target.value))}
                className="w-28 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-white focus:border-purple-500 focus:outline-none"
              />
            </label>
            <span className="text-xs text-slate-500 sm:ml-auto">{filtered.length} shown</span>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={
                  suggestions.length === 0 ? 'No look-alike suggestions yet' : 'No suggestions match your filters'
                }
                description={
                  suggestions.length === 0
                    ? 'Recompute to generate adoption-based suggestions from how similar peer accounts have adopted each product.'
                    : 'Loosen the adoption / ARR thresholds or clear the search.'
                }
                action={
                  suggestions.length === 0 ? (
                    <Button onClick={recompute} disabled={computing}>
                      {computing ? 'Computing...' : 'Compute suggestions'}
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH className="w-8">
                    <input
                      type="checkbox"
                      checked={selected.size === filtered.length && filtered.length > 0}
                      onChange={toggleAll}
                      className="h-4 w-4 rounded border-slate-700 bg-slate-800 text-purple-600"
                      aria-label="Select all"
                    />
                  </TH>
                  <TH>Account</TH>
                  <TH>Product</TH>
                  <TH>Segment</TH>
                  <TH className="text-right">Peer adoption</TH>
                  <TH className="text-right">Open ARR</TH>
                  <TH>Score</TH>
                  <TH>Why</TH>
                  <TH className="text-right">Action</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((s) => (
                  <TR key={s.id}>
                    <TD>
                      <input
                        type="checkbox"
                        checked={selected.has(s.id)}
                        onChange={() => toggle(s.id)}
                        className="h-4 w-4 rounded border-slate-700 bg-slate-800 text-purple-600"
                        aria-label={`Select ${s.account_name ?? s.id}`}
                      />
                    </TD>
                    <TD className="text-slate-200">{s.account_name ?? s.account_id ?? '—'}</TD>
                    <TD className="text-slate-300">{s.product_name ?? s.product_id ?? '—'}</TD>
                    <TD>{s.segment ? <Badge tone="slate">{s.segment}</Badge> : '—'}</TD>
                    <TD className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-slate-800 sm:block">
                          <div
                            className="h-full rounded-full bg-purple-500"
                            style={{ width: `${Math.min(100, (s.adoption_rate ?? 0) * 100)}%` }}
                          />
                        </div>
                        <span className="tabular-nums text-slate-300">{pct(s.adoption_rate)}</span>
                      </div>
                      {s.peer_count != null && (
                        <div className="text-[11px] text-slate-500">{s.peer_count} peers</div>
                      )}
                    </TD>
                    <TD className="text-right font-medium tabular-nums text-white">
                      {fmtUsdFull(s.open_arr_cents)}
                    </TD>
                    <TD>
                      <Badge tone={scoreTone(s.score)}>
                        {s.score == null ? '—' : s.score.toFixed(2)}
                      </Badge>
                    </TD>
                    <TD>
                      <span className="block max-w-xs text-xs text-slate-400">{s.explanation ?? '—'}</span>
                    </TD>
                    <TD className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => openQueueSingle(s)}>
                        Add to queue
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Modal
        open={playModal !== null}
        onClose={() => setPlayModal(null)}
        title={
          playModal && playModal.targets.length === 1
            ? `Queue play — ${playModal.targets[0].account_name ?? 'account'}`
            : `Queue ${playModal?.targets.length ?? 0} plays`
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setPlayModal(null)} disabled={creatingPlay}>
              Cancel
            </Button>
            <Button onClick={createPlays} disabled={creatingPlay}>
              {creatingPlay ? 'Adding...' : 'Add to play queue'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {playError && (
            <div className="rounded-lg border border-red-700 bg-red-900/30 px-3 py-2 text-sm text-red-300">
              {playError}
            </div>
          )}
          {playModal && playModal.targets.length > 1 && (
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-400">
              Creating one play per suggestion for {playModal.targets.length} accounts. Total open ARR:{' '}
              <span className="font-medium text-white">
                {fmtUsdFull(playModal.targets.reduce((a, s) => a + (s.open_arr_cents ?? 0), 0))}
              </span>
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Play type</label>
              <select
                value={playForm.play_type}
                onChange={(e) => setPlayForm({ ...playForm, play_type: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none"
              >
                <option value="cross_sell">Cross-sell</option>
                <option value="upsell">Upsell</option>
                <option value="adoption">Adoption</option>
                <option value="renewal">Renewal</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Initial stage</label>
              <select
                value={playForm.stage}
                onChange={(e) => setPlayForm({ ...playForm, stage: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none"
              >
                {PLAY_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-400">Owner</label>
              <input
                value={playForm.owner}
                onChange={(e) => setPlayForm({ ...playForm, owner: e.target.value })}
                placeholder="CSM / AE name"
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-400">Notes</label>
              <textarea
                value={playForm.notes}
                onChange={(e) => setPlayForm({ ...playForm, notes: e.target.value })}
                rows={2}
                placeholder="Defaults to the look-alike explanation"
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-purple-500 focus:outline-none"
              />
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}
