'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { PageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Account {
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

interface OwnedRow {
  product_id: string
  product_name?: string
  name?: string
  sku_code?: string
  quantity?: number
  owned_arr_cents?: number
}

interface WhitespaceRow {
  product_id: string
  product_name?: string
  name?: string
  open_arr_cents?: number
  method?: string
  confidence?: number | null
  low_arr_cents?: number
  high_arr_cents?: number
}

interface SeatRow {
  product_id: string
  product_name?: string
  name?: string
  licensed_seats?: number
  active_seats?: number
  assigned_seats?: number
}

interface PlayRow {
  id: string
  product_id?: string
  product_name?: string
  play_type?: string
  stage?: string
  owner?: string
  open_arr_cents?: number
  due_date?: string | null
}

interface LookalikeRow {
  product_id: string
  product_name?: string
  name?: string
  adoption_rate?: number
  peer_count?: number
  open_arr_cents?: number
  score?: number
  explanation?: string
}

interface AccountDetail {
  account: Account
  owned: OwnedRow[]
  whitespace: WhitespaceRow[]
  seats: SeatRow[]
  plays: PlayRow[]
  lookalikes: LookalikeRow[]
}

function fmtUsd(cents?: number | null): string {
  const n = (cents ?? 0) / 100
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function fmtPct(v?: number | null): string {
  if (v == null) return '—'
  const pct = v <= 1 ? v * 100 : v
  return `${pct.toFixed(0)}%`
}

const STAGES = ['identified', 'qualified', 'proposed', 'committed', 'won', 'lost']

export default function AccountDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = params?.id as string

  const [detail, setDetail] = useState<AccountDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [banner, setBanner] = useState<string | null>(null)

  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState<Partial<Account>>({})
  const [saving, setSaving] = useState(false)

  const [playOpen, setPlayOpen] = useState(false)
  const [playForm, setPlayForm] = useState<{ product_id: string; play_type: string; stage: string; owner: string; open_arr_cents: string; due_date: string; notes: string }>({
    product_id: '',
    play_type: 'cross-sell',
    stage: 'identified',
    owner: '',
    open_arr_cents: '',
    due_date: '',
    notes: '',
  })
  const [creatingPlay, setCreatingPlay] = useState(false)

  const [qbrBusy, setQbrBusy] = useState(false)
  const [qbr, setQbr] = useState<any | null>(null)
  const [qbrOpen, setQbrOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getAccount(id)
      setDetail(data)
    } catch (e: any) {
      setError(e?.message || 'Failed to load account')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    if (id) load()
  }, [id, load])

  const account = detail?.account
  const owned = detail?.owned ?? []
  const whitespace = detail?.whitespace ?? []
  const seats = detail?.seats ?? []
  const plays = detail?.plays ?? []
  const lookalikes = detail?.lookalikes ?? []

  const totalOpenArr = useMemo(
    () => whitespace.reduce((s, w) => s + (w.open_arr_cents ?? 0), 0),
    [whitespace],
  )
  const totalOwnedArr = useMemo(
    () => owned.reduce((s, o) => s + (o.owned_arr_cents ?? 0), 0),
    [owned],
  )
  const seatPenetration = useMemo(() => {
    const lic = seats.reduce((s, r) => s + (r.licensed_seats ?? 0), 0)
    const act = seats.reduce((s, r) => s + (r.active_seats ?? 0), 0)
    return lic > 0 ? act / lic : 0
  }, [seats])

  const openEdit = () => {
    if (!account) return
    setEditForm({
      name: account.name,
      segment: account.segment ?? '',
      industry: account.industry ?? '',
      region: account.region ?? '',
      employee_band: account.employee_band ?? '',
      plan_tier: account.plan_tier ?? '',
      csm_owner: account.csm_owner ?? '',
      current_arr_cents: account.current_arr_cents ?? 0,
    })
    setEditOpen(true)
  }

  const saveEdit = async () => {
    setSaving(true)
    setError(null)
    try {
      await api.updateAccount(id, {
        name: editForm.name,
        segment: editForm.segment || null,
        industry: editForm.industry || null,
        region: editForm.region || null,
        employee_band: editForm.employee_band || null,
        plan_tier: editForm.plan_tier || null,
        csm_owner: editForm.csm_owner || null,
        current_arr_cents: Number(editForm.current_arr_cents) || 0,
      })
      setEditOpen(false)
      setBanner('Account updated')
      await load()
    } catch (e: any) {
      setError(e?.message || 'Failed to update account')
    } finally {
      setSaving(false)
    }
  }

  const openPlay = (productId?: string, arrCents?: number, type?: string) => {
    setPlayForm({
      product_id: productId ?? (whitespace[0]?.product_id ?? owned[0]?.product_id ?? ''),
      play_type: type ?? 'cross-sell',
      stage: 'identified',
      owner: account?.csm_owner ?? '',
      open_arr_cents: arrCents != null ? String(Math.round(arrCents / 100)) : '',
      due_date: '',
      notes: '',
    })
    setPlayOpen(true)
  }

  const createPlay = async () => {
    setCreatingPlay(true)
    setError(null)
    try {
      await api.createPlay({
        account_id: id,
        product_id: playForm.product_id || null,
        play_type: playForm.play_type,
        stage: playForm.stage,
        owner: playForm.owner || null,
        open_arr_cents: Math.round((Number(playForm.open_arr_cents) || 0) * 100),
        due_date: playForm.due_date || null,
        notes: playForm.notes || null,
      })
      setPlayOpen(false)
      setBanner('Play added to queue')
      await load()
    } catch (e: any) {
      setError(e?.message || 'Failed to create play')
    } finally {
      setCreatingPlay(false)
    }
  }

  const runQbr = async () => {
    setQbrBusy(true)
    setError(null)
    try {
      const res = await api.generateQbr(id)
      setQbr(res?.payload ?? res)
      setQbrOpen(true)
      setBanner('QBR one-pager generated')
    } catch (e: any) {
      setError(e?.message || 'Failed to generate QBR')
    } finally {
      setQbrBusy(false)
    }
  }

  const downloadQbr = () => {
    const blob = new Blob([JSON.stringify(qbr ?? {}, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `qbr-${account?.external_id || id}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) return <PageSpinner label="Loading account..." />

  if (error && !detail) {
    return (
      <div className="mx-auto max-w-2xl">
        <EmptyState
          title="Could not load this account"
          description={error}
          action={
            <div className="flex gap-3">
              <Button onClick={load}>Retry</Button>
              <Link href="/dashboard/accounts">
                <Button variant="secondary">Back to accounts</Button>
              </Link>
            </div>
          }
        />
      </div>
    )
  }

  if (!account) {
    return (
      <EmptyState
        title="Account not found"
        action={
          <Link href="/dashboard/accounts">
            <Button variant="secondary">Back to accounts</Button>
          </Link>
        }
      />
    )
  }

  const productOptions = [
    ...whitespace.map((w) => ({ id: w.product_id, label: w.product_name || w.name || w.product_id })),
    ...owned
      .filter((o) => !whitespace.some((w) => w.product_id === o.product_id))
      .map((o) => ({ id: o.product_id, label: o.product_name || o.name || o.product_id })),
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <Link href="/dashboard/accounts" className="text-xs font-medium text-slate-500 hover:text-brand-300">
            ← Accounts
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-white">{account.name}</h1>
            {account.plan_tier && <Badge tone="purple">{account.plan_tier}</Badge>}
            {account.segment && <Badge tone="blue">{account.segment}</Badge>}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-500">
            {account.industry && <span>{account.industry}</span>}
            {account.region && <span>{account.region}</span>}
            {account.employee_band && <span>{account.employee_band} employees</span>}
            {account.csm_owner && <span>CSM: {account.csm_owner}</span>}
            {account.external_id && <span className="text-slate-600">#{account.external_id}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={openEdit}>
            Edit account
          </Button>
          <Button variant="secondary" onClick={() => openPlay()}>
            Add play
          </Button>
          <Button onClick={runQbr} disabled={qbrBusy}>
            {qbrBusy ? 'Generating…' : 'Generate QBR'}
          </Button>
        </div>
      </div>

      {banner && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">
          {banner}
        </div>
      )}
      {error && detail && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Current ARR" value={fmtUsd(account.current_arr_cents)} tone="default" />
        <Stat label="Open Whitespace ARR" value={fmtUsd(totalOpenArr)} tone="purple" hint={`${whitespace.length} sized cells`} />
        <Stat label="Owned Expansion ARR" value={fmtUsd(totalOwnedArr)} tone="green" hint={`${owned.length} products`} />
        <Stat label="Seat Penetration" value={fmtPct(seatPenetration)} tone="amber" hint={`${seats.length} licensed products`} />
      </div>

      {/* Whitespace one-pager */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Whitespace one-pager</h2>
          <span className="text-xs text-slate-500">Eligible-not-owned, sized</span>
        </CardHeader>
        <CardBody className="p-0">
          {whitespace.length === 0 ? (
            <div className="px-5 py-8">
              <EmptyState
                title="No sized whitespace yet"
                description="Run eligibility and sizing to surface open expansion ARR for this account."
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Product</TH>
                  <TH className="text-right">Open ARR</TH>
                  <TH className="text-right">Range</TH>
                  <TH>Method</TH>
                  <TH className="text-right">Confidence</TH>
                  <TH className="text-right">Action</TH>
                </TR>
              </THead>
              <TBody>
                {whitespace
                  .slice()
                  .sort((a, b) => (b.open_arr_cents ?? 0) - (a.open_arr_cents ?? 0))
                  .map((w) => {
                    const max = Math.max(...whitespace.map((x) => x.open_arr_cents ?? 0), 1)
                    const pct = ((w.open_arr_cents ?? 0) / max) * 100
                    return (
                      <TR key={w.product_id}>
                        <TD>
                          <div className="font-medium text-slate-100">{w.product_name || w.name || w.product_id}</div>
                          <div className="mt-1 h-1.5 w-32 overflow-hidden rounded-full bg-slate-800">
                            <div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
                          </div>
                        </TD>
                        <TD className="text-right font-semibold text-brand-300">{fmtUsd(w.open_arr_cents)}</TD>
                        <TD className="text-right text-xs text-slate-500">
                          {fmtUsd(w.low_arr_cents)} – {fmtUsd(w.high_arr_cents)}
                        </TD>
                        <TD>
                          <Badge tone="slate">{w.method || 'n/a'}</Badge>
                        </TD>
                        <TD className="text-right text-slate-400">{fmtPct(w.confidence)}</TD>
                        <TD className="text-right">
                          <Button size="sm" variant="ghost" onClick={() => openPlay(w.product_id, w.open_arr_cents, 'cross-sell')}>
                            Create play
                          </Button>
                        </TD>
                      </TR>
                    )
                  })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Owned */}
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-white">Owned products</h2>
          </CardHeader>
          <CardBody className="p-0">
            {owned.length === 0 ? (
              <div className="px-5 py-6 text-sm text-slate-500">No ownership recorded.</div>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Product</TH>
                    <TH className="text-right">Qty</TH>
                    <TH className="text-right">ARR</TH>
                  </TR>
                </THead>
                <TBody>
                  {owned.map((o) => (
                    <TR key={o.product_id}>
                      <TD className="text-slate-100">{o.product_name || o.name || o.product_id}</TD>
                      <TD className="text-right text-slate-400">{o.quantity ?? '—'}</TD>
                      <TD className="text-right text-emerald-300">{fmtUsd(o.owned_arr_cents)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>

        {/* Seats */}
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-white">Seat usage</h2>
          </CardHeader>
          <CardBody className="p-0">
            {seats.length === 0 ? (
              <div className="px-5 py-6 text-sm text-slate-500">No seat usage recorded.</div>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Product</TH>
                    <TH className="text-right">Active / Licensed</TH>
                    <TH className="text-right">Penetration</TH>
                  </TR>
                </THead>
                <TBody>
                  {seats.map((s) => {
                    const lic = s.licensed_seats ?? 0
                    const act = s.active_seats ?? 0
                    const pen = lic > 0 ? act / lic : 0
                    const over = act > lic && lic > 0
                    return (
                      <TR key={s.product_id}>
                        <TD className="text-slate-100">{s.product_name || s.name || s.product_id}</TD>
                        <TD className="text-right text-slate-300">
                          {act} / {lic}
                        </TD>
                        <TD className="text-right">
                          <span className={over ? 'text-amber-300' : 'text-slate-400'}>{fmtPct(pen)}</span>
                          {over && (
                            <Badge tone="amber" className="ml-2">
                              overage
                            </Badge>
                          )}
                        </TD>
                      </TR>
                    )
                  })}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Lookalikes */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-white">Look-alike suggestions</h2>
        </CardHeader>
        <CardBody className="p-0">
          {lookalikes.length === 0 ? (
            <div className="px-5 py-6 text-sm text-slate-500">No peer-adoption suggestions for this account.</div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Product</TH>
                  <TH className="text-right">Peer adoption</TH>
                  <TH className="text-right">Peers</TH>
                  <TH className="text-right">Open ARR</TH>
                  <TH className="text-right">Score</TH>
                  <TH className="text-right">Action</TH>
                </TR>
              </THead>
              <TBody>
                {lookalikes
                  .slice()
                  .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
                  .map((l) => (
                    <TR key={l.product_id}>
                      <TD>
                        <div className="text-slate-100">{l.product_name || l.name || l.product_id}</div>
                        {l.explanation && <div className="text-xs text-slate-500">{l.explanation}</div>}
                      </TD>
                      <TD className="text-right text-slate-300">{fmtPct(l.adoption_rate)}</TD>
                      <TD className="text-right text-slate-400">{l.peer_count ?? '—'}</TD>
                      <TD className="text-right text-brand-300">{fmtUsd(l.open_arr_cents)}</TD>
                      <TD className="text-right text-slate-300">{l.score != null ? l.score.toFixed(2) : '—'}</TD>
                      <TD className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => openPlay(l.product_id, l.open_arr_cents, 'cross-sell')}>
                          Create play
                        </Button>
                      </TD>
                    </TR>
                  ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Plays */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Plays</h2>
          <Button size="sm" variant="secondary" onClick={() => openPlay()}>
            New play
          </Button>
        </CardHeader>
        <CardBody className="p-0">
          {plays.length === 0 ? (
            <div className="px-5 py-6 text-sm text-slate-500">No plays on this account yet.</div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Type</TH>
                  <TH>Product</TH>
                  <TH>Stage</TH>
                  <TH>Owner</TH>
                  <TH className="text-right">Open ARR</TH>
                  <TH>Due</TH>
                </TR>
              </THead>
              <TBody>
                {plays.map((p) => (
                  <TR key={p.id} className="cursor-pointer" onClick={() => router.push(`/dashboard/plays/${p.id}`)}>
                    <TD className="capitalize text-slate-100">{p.play_type || '—'}</TD>
                    <TD className="text-slate-300">{p.product_name || p.product_id || '—'}</TD>
                    <TD>
                      <Badge tone={p.stage === 'won' ? 'green' : p.stage === 'lost' ? 'red' : 'blue'}>{p.stage || '—'}</Badge>
                    </TD>
                    <TD className="text-slate-400">{p.owner || '—'}</TD>
                    <TD className="text-right text-brand-300">{fmtUsd(p.open_arr_cents)}</TD>
                    <TD className="text-slate-400">{p.due_date ? new Date(p.due_date).toLocaleDateString() : '—'}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Edit modal */}
      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit account"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={saving || !editForm.name}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name" className="col-span-2">
            <input className={inputCls} value={editForm.name ?? ''} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
          </Field>
          <Field label="Segment">
            <input className={inputCls} value={editForm.segment ?? ''} onChange={(e) => setEditForm({ ...editForm, segment: e.target.value })} />
          </Field>
          <Field label="Industry">
            <input className={inputCls} value={editForm.industry ?? ''} onChange={(e) => setEditForm({ ...editForm, industry: e.target.value })} />
          </Field>
          <Field label="Region">
            <input className={inputCls} value={editForm.region ?? ''} onChange={(e) => setEditForm({ ...editForm, region: e.target.value })} />
          </Field>
          <Field label="Employee band">
            <input className={inputCls} value={editForm.employee_band ?? ''} onChange={(e) => setEditForm({ ...editForm, employee_band: e.target.value })} />
          </Field>
          <Field label="Plan tier">
            <input className={inputCls} value={editForm.plan_tier ?? ''} onChange={(e) => setEditForm({ ...editForm, plan_tier: e.target.value })} />
          </Field>
          <Field label="CSM owner">
            <input className={inputCls} value={editForm.csm_owner ?? ''} onChange={(e) => setEditForm({ ...editForm, csm_owner: e.target.value })} />
          </Field>
          <Field label="Current ARR (USD)" className="col-span-2">
            <input
              type="number"
              className={inputCls}
              value={(Number(editForm.current_arr_cents ?? 0) / 100).toString()}
              onChange={(e) => setEditForm({ ...editForm, current_arr_cents: Math.round((Number(e.target.value) || 0) * 100) })}
            />
          </Field>
        </div>
      </Modal>

      {/* Create play modal */}
      <Modal
        open={playOpen}
        onClose={() => setPlayOpen(false)}
        title="Create play"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPlayOpen(false)}>
              Cancel
            </Button>
            <Button onClick={createPlay} disabled={creatingPlay}>
              {creatingPlay ? 'Creating…' : 'Add to queue'}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Product" className="col-span-2">
            <select className={inputCls} value={playForm.product_id} onChange={(e) => setPlayForm({ ...playForm, product_id: e.target.value })}>
              <option value="">— none —</option>
              {productOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Play type">
            <select className={inputCls} value={playForm.play_type} onChange={(e) => setPlayForm({ ...playForm, play_type: e.target.value })}>
              <option value="cross-sell">cross-sell</option>
              <option value="up-sell">up-sell</option>
              <option value="seat-expansion">seat-expansion</option>
              <option value="renewal">renewal</option>
            </select>
          </Field>
          <Field label="Stage">
            <select className={inputCls} value={playForm.stage} onChange={(e) => setPlayForm({ ...playForm, stage: e.target.value })}>
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Owner">
            <input className={inputCls} value={playForm.owner} onChange={(e) => setPlayForm({ ...playForm, owner: e.target.value })} />
          </Field>
          <Field label="Open ARR (USD)">
            <input type="number" className={inputCls} value={playForm.open_arr_cents} onChange={(e) => setPlayForm({ ...playForm, open_arr_cents: e.target.value })} />
          </Field>
          <Field label="Due date">
            <input type="date" className={inputCls} value={playForm.due_date} onChange={(e) => setPlayForm({ ...playForm, due_date: e.target.value })} />
          </Field>
          <Field label="Notes" className="col-span-2">
            <textarea className={inputCls} rows={3} value={playForm.notes} onChange={(e) => setPlayForm({ ...playForm, notes: e.target.value })} />
          </Field>
        </div>
      </Modal>

      {/* QBR modal */}
      <Modal
        open={qbrOpen}
        onClose={() => setQbrOpen(false)}
        title="QBR one-pager"
        className="max-w-2xl"
        footer={
          <>
            <Button variant="secondary" onClick={() => setQbrOpen(false)}>
              Close
            </Button>
            <Button onClick={downloadQbr}>Download JSON</Button>
          </>
        }
      >
        <QbrView payload={qbr} account={account} fmtUsd={fmtUsd} />
      </Modal>
    </div>
  )
}

const inputCls =
  'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand-500'

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-medium text-slate-400">{label}</span>
      {children}
    </label>
  )
}

function QbrView({ payload, account, fmtUsd }: { payload: any; account: Account; fmtUsd: (c?: number | null) => string }) {
  if (!payload) return <div className="text-sm text-slate-500">No payload returned.</div>
  const summary = payload.summary ?? payload
  const lines: Array<{ k: string; v: string }> = []
  const push = (k: string, v: any) => {
    if (v != null) lines.push({ k, v: typeof v === 'number' && /arr|cents/i.test(k) ? fmtUsd(v) : String(v) })
  }
  push('Account', account.name)
  push('Total open ARR', summary.total_open_arr_cents ?? summary.open_arr_cents)
  push('Owned ARR', summary.total_owned_arr_cents ?? summary.owned_arr_cents)
  push('Whitespace cells', summary.whitespace_count ?? (Array.isArray(payload.whitespace) ? payload.whitespace.length : undefined))
  push('Plays', summary.play_count ?? (Array.isArray(payload.plays) ? payload.plays.length : undefined))

  const topWhitespace: any[] = payload.whitespace ?? payload.top_whitespace ?? []

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {lines.map((l) => (
          <div key={l.k} className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
            <div className="text-[11px] uppercase tracking-wide text-slate-500">{l.k}</div>
            <div className="text-sm font-semibold text-slate-100">{l.v}</div>
          </div>
        ))}
      </div>
      {Array.isArray(topWhitespace) && topWhitespace.length > 0 && (
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Top whitespace</div>
          <div className="space-y-1.5">
            {topWhitespace.slice(0, 8).map((w: any, i: number) => (
              <div key={i} className="flex items-center justify-between rounded-md bg-slate-950/60 px-3 py-1.5 text-sm">
                <span className="text-slate-200">{w.product_name || w.name || w.product_id || `Product ${i + 1}`}</span>
                <span className="font-medium text-brand-300">{fmtUsd(w.open_arr_cents)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <details className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
        <summary className="cursor-pointer text-xs text-slate-500">Raw payload</summary>
        <pre className="mt-2 max-h-64 overflow-auto text-[11px] text-slate-400">{JSON.stringify(payload, null, 2)}</pre>
      </details>
    </div>
  )
}
