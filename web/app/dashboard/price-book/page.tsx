'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { PageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'

interface Product {
  id: string
  sku_code: string
  name: string
}

interface PriceEntry {
  id: string
  product_id: string
  product_name?: string
  segment?: string | null
  currency?: string | null
  term?: string | null
  list_price_cents?: number | null
  per_seat_cents?: number | null
  seat_band_min?: number | null
  seat_band_max?: number | null
  effective_from?: string | null
  is_active?: boolean
}

interface PriceForm {
  product_id: string
  segment: string
  currency: string
  term: string
  list_price: string
  per_seat: string
  seat_band_min: string
  seat_band_max: string
  effective_from: string
  is_active: boolean
}

const emptyForm: PriceForm = {
  product_id: '',
  segment: '',
  currency: 'USD',
  term: 'annual',
  list_price: '',
  per_seat: '',
  seat_band_min: '',
  seat_band_max: '',
  effective_from: '',
  is_active: true,
}

function fmtMoney(cents?: number | null, currency = 'USD'): string {
  if (cents == null) return '—'
  const n = cents / 100
  const sym = currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$'
  if (Math.abs(n) >= 1_000_000) return `${sym}${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 1_000) return `${sym}${(n / 1_000).toFixed(1)}K`
  return `${sym}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

const inputCls =
  'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand-500'

export default function PriceBookPage() {
  const [entries, setEntries] = useState<PriceEntry[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [banner, setBanner] = useState<string | null>(null)

  const [productFilter, setProductFilter] = useState('')
  const [segmentFilter, setSegmentFilter] = useState('')
  const [search, setSearch] = useState('')

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<PriceEntry | null>(null)
  const [form, setForm] = useState<PriceForm>(emptyForm)
  const [saving, setSaving] = useState(false)

  const productName = useCallback(
    (id: string) => products.find((p) => p.id === id)?.name ?? id,
    [products],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [pb, prods] = await Promise.all([api.listPriceBook(), api.listProducts()])
      setEntries(Array.isArray(pb) ? pb : pb?.entries ?? [])
      setProducts(Array.isArray(prods) ? prods : prods?.products ?? [])
    } catch (e: any) {
      setError(e?.message || 'Failed to load price book')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const reloadEntries = useCallback(async () => {
    try {
      const params: Record<string, string> = {}
      if (productFilter) params.product_id = productFilter
      if (segmentFilter) params.segment = segmentFilter
      const pb = await api.listPriceBook(params)
      setEntries(Array.isArray(pb) ? pb : pb?.entries ?? [])
    } catch (e: any) {
      setError(e?.message || 'Failed to filter price book')
    }
  }, [productFilter, segmentFilter])

  useEffect(() => {
    if (!loading) reloadEntries()
  }, [productFilter, segmentFilter, loading, reloadEntries])

  const segments = useMemo(
    () => Array.from(new Set(entries.map((e) => e.segment).filter(Boolean))) as string[],
    [entries],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return entries
    return entries.filter((e) =>
      `${productName(e.product_id)} ${e.segment ?? ''} ${e.term ?? ''} ${e.currency ?? ''}`.toLowerCase().includes(q),
    )
  }, [entries, search, productName])

  const stats = useMemo(() => {
    const active = entries.filter((e) => e.is_active).length
    const avgList = entries.length
      ? entries.reduce((s, e) => s + (e.list_price_cents ?? 0), 0) / entries.length
      : 0
    const withSeat = entries.filter((e) => (e.per_seat_cents ?? 0) > 0).length
    return { total: entries.length, active, avgList, withSeat }
  }, [entries])

  const openCreate = () => {
    setEditing(null)
    setForm({ ...emptyForm, product_id: products[0]?.id ?? '' })
    setFormOpen(true)
  }

  const openEdit = (e: PriceEntry) => {
    setEditing(e)
    setForm({
      product_id: e.product_id,
      segment: e.segment ?? '',
      currency: e.currency ?? 'USD',
      term: e.term ?? 'annual',
      list_price: e.list_price_cents != null ? String(e.list_price_cents / 100) : '',
      per_seat: e.per_seat_cents != null ? String(e.per_seat_cents / 100) : '',
      seat_band_min: e.seat_band_min != null ? String(e.seat_band_min) : '',
      seat_band_max: e.seat_band_max != null ? String(e.seat_band_max) : '',
      effective_from: e.effective_from ? e.effective_from.slice(0, 10) : '',
      is_active: e.is_active ?? true,
    })
    setFormOpen(true)
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    const body = {
      product_id: form.product_id,
      segment: form.segment || null,
      currency: form.currency || 'USD',
      term: form.term || null,
      list_price_cents: form.list_price === '' ? null : Math.round(Number(form.list_price) * 100),
      per_seat_cents: form.per_seat === '' ? null : Math.round(Number(form.per_seat) * 100),
      seat_band_min: form.seat_band_min === '' ? null : Number(form.seat_band_min),
      seat_band_max: form.seat_band_max === '' ? null : Number(form.seat_band_max),
      effective_from: form.effective_from || null,
      is_active: form.is_active,
    }
    try {
      if (editing) {
        await api.updatePriceEntry(editing.id, body)
        setBanner('Price entry updated')
      } else {
        await api.createPriceEntry(body)
        setBanner('Price entry created')
      }
      setFormOpen(false)
      await reloadEntries()
    } catch (e: any) {
      setError(e?.message || 'Failed to save price entry')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (e: PriceEntry) => {
    if (!confirm(`Delete this price entry for ${productName(e.product_id)}?`)) return
    setError(null)
    try {
      await api.deletePriceEntry(e.id)
      setBanner('Price entry deleted')
      await reloadEntries()
    } catch (err: any) {
      setError(err?.message || 'Failed to delete price entry')
    }
  }

  if (loading) return <PageSpinner label="Loading price book..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Price Book</h1>
          <p className="mt-1 text-sm text-slate-500">List, per-seat, and seat-band pricing by product and segment.</p>
        </div>
        <Button onClick={openCreate} disabled={products.length === 0}>New price entry</Button>
      </div>

      {banner && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">{banner}</div>
      )}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">{error}</div>
      )}
      {products.length === 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-300">
          Add products in the Catalog before creating price entries.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Entries" value={stats.total} />
        <Stat label="Active" value={stats.active} tone="green" />
        <Stat label="Avg list price" value={fmtMoney(stats.avgList)} tone="purple" />
        <Stat label="Per-seat entries" value={stats.withSeat} tone="amber" />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <input
              placeholder="Search…"
              className="w-44 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-brand-500"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200" value={productFilter} onChange={(e) => setProductFilter(e.target.value)}>
              <option value="">All products</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <select className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200" value={segmentFilter} onChange={(e) => setSegmentFilter(e.target.value)}>
              <option value="">All segments</option>
              {segments.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            {(productFilter || segmentFilter || search) && (
              <Button size="sm" variant="ghost" onClick={() => { setProductFilter(''); setSegmentFilter(''); setSearch('') }}>Clear</Button>
            )}
          </div>
          <span className="text-xs text-slate-500">{filtered.length} of {entries.length}</span>
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="px-5 py-8">
              <EmptyState
                title={entries.length === 0 ? 'No price entries yet' : 'No entries match your filters'}
                description={entries.length === 0 ? 'Create a price entry to drive whitespace sizing.' : 'Adjust filters above.'}
                action={entries.length === 0 && products.length > 0 ? <Button onClick={openCreate}>New price entry</Button> : undefined}
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-slate-900/80 text-left">
                  <tr>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Product</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Segment</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Term</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-400">List</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-400">Per seat</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Seat band</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Effective</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Status</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-400">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {filtered.map((e) => (
                    <tr key={e.id} className="hover:bg-slate-900/40">
                      <td className="px-4 py-3 font-medium text-slate-100">{e.product_name || productName(e.product_id)}</td>
                      <td className="px-4 py-3">{e.segment ? <Badge tone="blue">{e.segment}</Badge> : <span className="text-slate-500">all</span>}</td>
                      <td className="px-4 py-3 text-slate-300">{e.term || '—'} <span className="text-xs text-slate-600">{e.currency || 'USD'}</span></td>
                      <td className="px-4 py-3 text-right text-slate-100">{fmtMoney(e.list_price_cents, e.currency ?? 'USD')}</td>
                      <td className="px-4 py-3 text-right text-brand-300">{fmtMoney(e.per_seat_cents, e.currency ?? 'USD')}</td>
                      <td className="px-4 py-3 text-slate-400">
                        {e.seat_band_min != null || e.seat_band_max != null ? `${e.seat_band_min ?? 0}–${e.seat_band_max ?? '∞'}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-400">{e.effective_from ? new Date(e.effective_from).toLocaleDateString() : '—'}</td>
                      <td className="px-4 py-3">{e.is_active ? <Badge tone="green">active</Badge> : <Badge tone="slate">inactive</Badge>}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(e)}>Edit</Button>
                          <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300" onClick={() => remove(e)}>Delete</Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Edit price entry' : 'New price entry'}
        className="max-w-xl"
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving || !form.product_id}>{saving ? 'Saving…' : 'Save'}</Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Product" className="col-span-2">
            <select className={inputCls} value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })}>
              <option value="">— select product —</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.sku_code})</option>
              ))}
            </select>
          </Field>
          <Field label="Segment">
            <input className={inputCls} placeholder="e.g. Enterprise" value={form.segment} onChange={(e) => setForm({ ...form, segment: e.target.value })} />
          </Field>
          <Field label="Currency">
            <select className={inputCls} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
            </select>
          </Field>
          <Field label="Term">
            <select className={inputCls} value={form.term} onChange={(e) => setForm({ ...form, term: e.target.value })}>
              <option value="monthly">monthly</option>
              <option value="annual">annual</option>
              <option value="multi-year">multi-year</option>
            </select>
          </Field>
          <Field label="Effective from">
            <input type="date" className={inputCls} value={form.effective_from} onChange={(e) => setForm({ ...form, effective_from: e.target.value })} />
          </Field>
          <Field label="List price (per currency unit)">
            <input type="number" className={inputCls} value={form.list_price} onChange={(e) => setForm({ ...form, list_price: e.target.value })} />
          </Field>
          <Field label="Per-seat price">
            <input type="number" className={inputCls} value={form.per_seat} onChange={(e) => setForm({ ...form, per_seat: e.target.value })} />
          </Field>
          <Field label="Seat band min">
            <input type="number" className={inputCls} value={form.seat_band_min} onChange={(e) => setForm({ ...form, seat_band_min: e.target.value })} />
          </Field>
          <Field label="Seat band max">
            <input type="number" className={inputCls} value={form.seat_band_max} onChange={(e) => setForm({ ...form, seat_band_max: e.target.value })} />
          </Field>
          <Field label="Status" className="col-span-2">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
              Active
            </label>
          </Field>
        </div>
      </Modal>
    </div>
  )
}

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-medium text-slate-400">{label}</span>
      {children}
    </label>
  )
}
