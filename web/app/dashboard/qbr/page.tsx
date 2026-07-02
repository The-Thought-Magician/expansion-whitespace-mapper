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

type Account = {
  id: string
  name?: string | null
  segment?: string | null
  industry?: string | null
  region?: string | null
  csm_owner?: string | null
  current_arr_cents?: number | null
}

type QbrExport = {
  id: string
  account_id?: string | null
  payload?: any
  created_at?: string | null
}

function fmtArr(cents?: number | null): string {
  if (cents == null) return '—'
  const dollars = cents / 100
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(2)}M`
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(1)}K`
  return `$${dollars.toFixed(0)}`
}

function fmtDate(s?: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function fmtDateTime(s?: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

// Coerce arbitrary cent-bearing keys out of a payload object.
function payloadArr(p: any): number | null {
  if (!p || typeof p !== 'object') return null
  const keys = ['total_open_arr_cents', 'open_arr_cents', 'whitespace_arr_cents', 'total_arr_cents']
  for (const k of keys) {
    if (typeof p[k] === 'number') return p[k]
  }
  return null
}

function payloadAccountName(p: any): string | null {
  if (!p || typeof p !== 'object') return null
  if (typeof p.account_name === 'string') return p.account_name
  if (p.account && typeof p.account.name === 'string') return p.account.name
  return null
}

export default function QbrPage() {
  const [exports, setExports] = useState<QbrExport[] | null>(null)
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // generate modal
  const [genOpen, setGenOpen] = useState(false)
  const [genAccountId, setGenAccountId] = useState('')
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)

  // view modal
  const [viewing, setViewing] = useState<QbrExport | null>(null)
  const [viewLoading, setViewLoading] = useState(false)
  const [viewError, setViewError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [e, a] = await Promise.all([api.listQbrExports(), api.listAccounts()])
      setExports(Array.isArray(e) ? (e as QbrExport[]) : [])
      setAccounts(Array.isArray(a) ? (a as Account[]) : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load QBR exports')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const accountMap = useMemo(() => {
    const m = new Map<string, Account>()
    for (const a of accounts ?? []) m.set(a.id, a)
    return m
  }, [accounts])

  function exportAccountName(e: QbrExport): string {
    return (
      payloadAccountName(e.payload) ||
      (e.account_id ? accountMap.get(e.account_id)?.name ?? null : null) ||
      'Unknown account'
    )
  }

  const rows = useMemo(() => {
    let list = exports ?? []
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter((e) => exportAccountName(e).toLowerCase().includes(q))
    }
    return [...list].sort((a, b) => {
      const ta = a.created_at ? Date.parse(a.created_at) : 0
      const tb = b.created_at ? Date.parse(b.created_at) : 0
      return tb - ta
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exports, search, accountMap])

  const totals = useMemo(() => {
    const list = exports ?? []
    const accountIds = new Set(list.map((e) => e.account_id).filter(Boolean))
    const latest = list.reduce<string | null>((acc, e) => {
      if (!e.created_at) return acc
      if (!acc || Date.parse(e.created_at) > Date.parse(acc)) return e.created_at
      return acc
    }, null)
    return { count: list.length, accounts: accountIds.size, latest }
  }, [exports])

  async function handleGenerate() {
    if (!genAccountId) {
      setGenError('Select an account first.')
      return
    }
    setGenerating(true)
    setGenError(null)
    try {
      await api.generateQbr(genAccountId)
      setGenOpen(false)
      setGenAccountId('')
      await load()
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Failed to generate QBR')
    } finally {
      setGenerating(false)
    }
  }

  async function openView(e: QbrExport) {
    setViewing(e)
    setViewError(null)
    // If the list payload is thin, fetch the full export.
    if (e.payload && typeof e.payload === 'object' && Object.keys(e.payload).length > 0) return
    setViewLoading(true)
    try {
      const full = (await api.getQbrExport(e.id)) as QbrExport
      setViewing(full)
    } catch (err) {
      setViewError(err instanceof Error ? err.message : 'Failed to load export payload')
    } finally {
      setViewLoading(false)
    }
  }

  if (loading) return <PageSpinner label="Loading QBR exports..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">QBR Exports</h1>
          <p className="mt-1 text-sm text-slate-400">
            Generated quarterly business review one-pagers. Snapshot whitespace, owned ARR, and
            recommended plays per account.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={load}>
            Refresh
          </Button>
          <Button onClick={() => { setGenOpen(true); setGenError(null) }}>Generate QBR</Button>
        </div>
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

      {!error && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Stat label="Total Exports" value={totals.count} tone="purple" />
            <Stat label="Accounts Covered" value={totals.accounts} />
            <Stat label="Latest Export" value={totals.latest ? fmtDate(totals.latest) : '—'} />
          </div>

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-white">Export Library</h2>
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search account..."
                  className="w-56 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-brand-500 focus:outline-none"
                />
              </div>
            </CardHeader>
            <CardBody>
              {rows.length === 0 ? (
                <EmptyState
                  title={search ? 'No exports match your search' : 'No QBR exports yet'}
                  description={
                    search
                      ? 'Try a different account name.'
                      : 'Generate a QBR one-pager for an account to build your export library.'
                  }
                  action={
                    !search ? (
                      <Button onClick={() => setGenOpen(true)}>Generate your first QBR</Button>
                    ) : undefined
                  }
                />
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Account</TH>
                      <TH>Open ARR</TH>
                      <TH>Generated</TH>
                      <TH className="text-right">Actions</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {rows.map((e) => {
                      const acct = e.account_id ? accountMap.get(e.account_id) : undefined
                      const arr = payloadArr(e.payload)
                      return (
                        <TR key={e.id}>
                          <TD className="font-medium text-white">
                            <div>{exportAccountName(e)}</div>
                            {acct?.segment && (
                              <div className="mt-0.5">
                                <Badge tone="slate">{acct.segment}</Badge>
                              </div>
                            )}
                          </TD>
                          <TD className="tabular-nums text-brand-300">
                            {arr != null ? fmtArr(arr) : '—'}
                          </TD>
                          <TD className="text-slate-400">{fmtDateTime(e.created_at)}</TD>
                          <TD className="text-right">
                            <Button variant="secondary" size="sm" onClick={() => openView(e)}>
                              View
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
        </>
      )}

      {/* Generate QBR modal */}
      <Modal
        open={genOpen}
        onClose={() => { if (!generating) setGenOpen(false) }}
        title="Generate QBR Export"
        footer={
          <>
            <Button variant="ghost" onClick={() => setGenOpen(false)} disabled={generating}>
              Cancel
            </Button>
            <Button onClick={handleGenerate} disabled={generating}>
              {generating ? 'Generating...' : 'Generate'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-400">
            Builds a one-pager payload from the account&apos;s current whitespace, ownership, and
            plays, then saves it to your export library.
          </p>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Account
            </span>
            <select
              value={genAccountId}
              onChange={(e) => setGenAccountId(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-brand-500 focus:outline-none"
            >
              <option value="">Select an account…</option>
              {(accounts ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name ?? a.id}
                  {a.csm_owner ? ` — ${a.csm_owner}` : ''}
                </option>
              ))}
            </select>
          </label>
          {(accounts ?? []).length === 0 && (
            <p className="text-xs text-amber-300">
              No accounts found. Add accounts before generating a QBR.
            </p>
          )}
          {genError && <p className="text-sm text-red-300">{genError}</p>}
        </div>
      </Modal>

      {/* View QBR modal */}
      <Modal
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing ? `QBR — ${exportAccountName(viewing)}` : 'QBR'}
        className="max-w-3xl"
        footer={
          <Button variant="ghost" onClick={() => setViewing(null)}>
            Close
          </Button>
        }
      >
        {viewing && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
              <span>Generated {fmtDateTime(viewing.created_at)}</span>
              {payloadArr(viewing.payload) != null && (
                <Badge tone="purple">Open ARR {fmtArr(payloadArr(viewing.payload))}</Badge>
              )}
            </div>
            {viewLoading ? (
              <PageSpinner label="Loading payload..." />
            ) : viewError ? (
              <p className="text-sm text-red-300">{viewError}</p>
            ) : (
              <QbrPayloadView payload={viewing.payload} />
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}

function QbrPayloadView({ payload }: { payload: any }) {
  if (!payload || typeof payload !== 'object') {
    return <p className="text-sm text-slate-500">No payload content.</p>
  }

  const summaryArr = payloadArr(payload)
  const ownedArr =
    typeof payload.total_owned_arr_cents === 'number'
      ? payload.total_owned_arr_cents
      : typeof payload.owned_arr_cents === 'number'
        ? payload.owned_arr_cents
        : null
  const whitespace: any[] = Array.isArray(payload.whitespace)
    ? payload.whitespace
    : Array.isArray(payload.sizing)
      ? payload.sizing
      : []
  const plays: any[] = Array.isArray(payload.plays) ? payload.plays : []
  const lookalikes: any[] = Array.isArray(payload.lookalikes) ? payload.lookalikes : []

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Open ARR" value={summaryArr != null ? fmtArr(summaryArr) : '—'} tone="purple" />
        <Stat label="Owned ARR" value={ownedArr != null ? fmtArr(ownedArr) : '—'} tone="green" />
        <Stat label="Open Plays" value={plays.length} />
      </div>

      {whitespace.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-white">Whitespace</h3>
          <Table>
            <THead>
              <TR>
                <TH>Product</TH>
                <TH className="text-right">Open ARR</TH>
                <TH>Method</TH>
              </TR>
            </THead>
            <TBody>
              {whitespace.map((w, i) => (
                <TR key={i}>
                  <TD className="text-slate-200">{w.product_name ?? w.product_id ?? '—'}</TD>
                  <TD className="text-right tabular-nums text-brand-300">
                    {fmtArr(w.open_arr_cents)}
                  </TD>
                  <TD className="text-slate-400">{w.method ?? '—'}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </section>
      )}

      {plays.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-white">Recommended Plays</h3>
          <Table>
            <THead>
              <TR>
                <TH>Play</TH>
                <TH>Stage</TH>
                <TH className="text-right">Open ARR</TH>
              </TR>
            </THead>
            <TBody>
              {plays.map((p, i) => (
                <TR key={i}>
                  <TD className="text-slate-200">{p.play_type ?? p.product_name ?? '—'}</TD>
                  <TD>
                    <Badge tone="blue">{p.stage ?? '—'}</Badge>
                  </TD>
                  <TD className="text-right tabular-nums text-brand-300">
                    {fmtArr(p.open_arr_cents)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </section>
      )}

      {lookalikes.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-white">Look-Alike Suggestions</h3>
          <ul className="space-y-1.5">
            {lookalikes.map((l, i) => (
              <li key={i} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-slate-300">{l.product_name ?? l.product_id ?? '—'}</span>
                <span className="tabular-nums text-brand-300">{fmtArr(l.open_arr_cents)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {whitespace.length === 0 && plays.length === 0 && lookalikes.length === 0 && (
        <details className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
          <summary className="cursor-pointer text-xs font-medium text-slate-400">
            Raw payload
          </summary>
          <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs text-slate-400">
            {JSON.stringify(payload, null, 2)}
          </pre>
        </details>
      )}
    </div>
  )
}
