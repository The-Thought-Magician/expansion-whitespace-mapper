'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'

interface Product {
  id: string
  sku_code: string
  name: string
  description?: string | null
  category?: string | null
  family?: string | null
  product_type?: string | null
  parent_product_id?: string | null
  is_active?: boolean
  default_expansion_arr_cents?: number | null
}

interface ProductForm {
  sku_code: string
  name: string
  description: string
  category: string
  family: string
  product_type: string
  parent_product_id: string
  is_active: boolean
  default_expansion_arr_cents: string
}

const emptyForm: ProductForm = {
  sku_code: '',
  name: '',
  description: '',
  category: '',
  family: '',
  product_type: 'module',
  parent_product_id: '',
  is_active: true,
  default_expansion_arr_cents: '',
}

function fmtUsd(cents?: number | null): string {
  const n = (cents ?? 0) / 100
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

const inputCls =
  'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand-500'

export default function CatalogPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [banner, setBanner] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [familyFilter, setFamilyFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [view, setView] = useState<'table' | 'hierarchy'>('table')

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [form, setForm] = useState<ProductForm>(emptyForm)
  const [saving, setSaving] = useState(false)

  const [detailOpen, setDetailOpen] = useState(false)
  const [detail, setDetail] = useState<{ product: Product; modules: Product[] } | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ imported: number; errors: any } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.listProducts()
      setProducts(Array.isArray(data) ? data : data?.products ?? [])
    } catch (e: any) {
      setError(e?.message || 'Failed to load catalog')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const families = useMemo(
    () => Array.from(new Set(products.map((p) => p.family).filter(Boolean))) as string[],
    [products],
  )
  const categories = useMemo(
    () => Array.from(new Set(products.map((p) => p.category).filter(Boolean))) as string[],
    [products],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products.filter((p) => {
      if (familyFilter && p.family !== familyFilter) return false
      if (categoryFilter && p.category !== categoryFilter) return false
      if (activeFilter === 'active' && !p.is_active) return false
      if (activeFilter === 'inactive' && p.is_active) return false
      if (q && !(`${p.name} ${p.sku_code} ${p.description ?? ''}`.toLowerCase().includes(q))) return false
      return true
    })
  }, [products, search, familyFilter, categoryFilter, activeFilter])

  const stats = useMemo(() => {
    const active = products.filter((p) => p.is_active).length
    const parents = products.filter((p) => !p.parent_product_id).length
    const totalArr = products.reduce((s, p) => s + (p.default_expansion_arr_cents ?? 0), 0)
    return { total: products.length, active, parents, modules: products.length - parents, totalArr }
  }, [products])

  // Build hierarchy: parents with children
  const hierarchy = useMemo(() => {
    const byParent = new Map<string, Product[]>()
    for (const p of filtered) {
      if (p.parent_product_id) {
        const arr = byParent.get(p.parent_product_id) ?? []
        arr.push(p)
        byParent.set(p.parent_product_id, arr)
      }
    }
    const roots = filtered.filter((p) => !p.parent_product_id || !filtered.some((x) => x.id === p.parent_product_id))
    return { roots, byParent }
  }, [filtered])

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm)
    setFormOpen(true)
  }

  const openEdit = (p: Product) => {
    setEditing(p)
    setForm({
      sku_code: p.sku_code,
      name: p.name,
      description: p.description ?? '',
      category: p.category ?? '',
      family: p.family ?? '',
      product_type: p.product_type ?? 'module',
      parent_product_id: p.parent_product_id ?? '',
      is_active: p.is_active ?? true,
      default_expansion_arr_cents: p.default_expansion_arr_cents != null ? String(p.default_expansion_arr_cents / 100) : '',
    })
    setFormOpen(true)
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    const body = {
      sku_code: form.sku_code,
      name: form.name,
      description: form.description || null,
      category: form.category || null,
      family: form.family || null,
      product_type: form.product_type || null,
      parent_product_id: form.parent_product_id || null,
      is_active: form.is_active,
      default_expansion_arr_cents: Math.round((Number(form.default_expansion_arr_cents) || 0) * 100),
    }
    try {
      if (editing) {
        await api.updateProduct(editing.id, body)
        setBanner(`Updated ${form.name}`)
      } else {
        await api.createProduct(body)
        setBanner(`Created ${form.name}`)
      }
      setFormOpen(false)
      await load()
    } catch (e: any) {
      setError(e?.message || 'Failed to save product')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (p: Product) => {
    if (!confirm(`Retire / delete "${p.name}"?`)) return
    setError(null)
    try {
      await api.deleteProduct(p.id)
      setBanner(`Removed ${p.name}`)
      await load()
    } catch (e: any) {
      setError(e?.message || 'Failed to delete product')
    }
  }

  const openDetail = async (p: Product) => {
    setDetailOpen(true)
    setDetail(null)
    setDetailLoading(true)
    try {
      const data = await api.getProduct(p.id)
      setDetail({ product: data?.product ?? p, modules: data?.modules ?? [] })
    } catch (e: any) {
      setError(e?.message || 'Failed to load product detail')
      setDetailOpen(false)
    } finally {
      setDetailLoading(false)
    }
  }

  const runImport = async () => {
    setImporting(true)
    setError(null)
    setImportResult(null)
    let rows: any[]
    try {
      const parsed = JSON.parse(importText)
      rows = Array.isArray(parsed) ? parsed : parsed?.rows ?? []
      if (!Array.isArray(rows)) throw new Error('Expected a JSON array of product rows')
    } catch (e: any) {
      setError(`Import parse error: ${e?.message || 'invalid JSON'}`)
      setImporting(false)
      return
    }
    try {
      const res = await api.importProducts({ rows })
      setImportResult({ imported: res?.imported ?? rows.length, errors: res?.errors ?? [] })
      setBanner(`Imported ${res?.imported ?? rows.length} products`)
      await load()
    } catch (e: any) {
      setError(e?.message || 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  const fillSampleImport = () => {
    setImportText(
      JSON.stringify(
        [
          { sku_code: 'CORE-PLAT', name: 'Core Platform', family: 'Platform', category: 'Core', product_type: 'platform', default_expansion_arr_cents: 5000000 },
          { sku_code: 'ANALYTICS', name: 'Analytics Module', family: 'Platform', category: 'Add-on', product_type: 'module', default_expansion_arr_cents: 1200000 },
        ],
        null,
        2,
      ),
    )
  }

  if (loading) return <PageSpinner label="Loading catalog..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Catalog</h1>
          <p className="mt-1 text-sm text-slate-500">Manage products, module hierarchy, and bulk import.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => { setImportResult(null); setImportOpen(true) }}>
            Import
          </Button>
          <Button onClick={openCreate}>New product</Button>
        </div>
      </div>

      {banner && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">{banner}</div>
      )}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Products" value={stats.total} />
        <Stat label="Active" value={stats.active} tone="green" />
        <Stat label="Parents / Modules" value={`${stats.parents} / ${stats.modules}`} tone="purple" />
        <Stat label="Default Expansion ARR" value={fmtUsd(stats.totalArr)} tone="amber" />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <input
              placeholder="Search name / SKU…"
              className="w-48 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-brand-500"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200" value={familyFilter} onChange={(e) => setFamilyFilter(e.target.value)}>
              <option value="">All families</option>
              {families.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
            <select className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <select className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200" value={activeFilter} onChange={(e) => setActiveFilter(e.target.value as any)}>
              <option value="all">All status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div className="flex rounded-lg border border-slate-700 p-0.5 text-xs">
            <button onClick={() => setView('table')} className={`rounded-md px-3 py-1 ${view === 'table' ? 'bg-brand-600 text-white' : 'text-slate-400'}`}>Table</button>
            <button onClick={() => setView('hierarchy')} className={`rounded-md px-3 py-1 ${view === 'hierarchy' ? 'bg-brand-600 text-white' : 'text-slate-400'}`}>Hierarchy</button>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="px-5 py-8">
              <EmptyState
                title={products.length === 0 ? 'No products yet' : 'No products match your filters'}
                description={products.length === 0 ? 'Create your first product or bulk-import a catalog.' : 'Adjust the search or filters above.'}
                action={products.length === 0 ? <Button onClick={openCreate}>New product</Button> : undefined}
              />
            </div>
          ) : view === 'table' ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-slate-900/80 text-left">
                  <tr>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Product</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-400">SKU</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Family</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Category</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Type</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-400">Default ARR</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Status</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-400">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {filtered.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-900/40">
                      <td className="px-4 py-3">
                        <button onClick={() => openDetail(p)} className="text-left font-medium text-slate-100 hover:text-brand-300">
                          {p.name}
                        </button>
                        {p.parent_product_id && <div className="text-xs text-slate-500">module</div>}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-400">{p.sku_code}</td>
                      <td className="px-4 py-3 text-slate-300">{p.family || '—'}</td>
                      <td className="px-4 py-3 text-slate-300">{p.category || '—'}</td>
                      <td className="px-4 py-3 text-slate-400">{p.product_type || '—'}</td>
                      <td className="px-4 py-3 text-right text-brand-300">{fmtUsd(p.default_expansion_arr_cents)}</td>
                      <td className="px-4 py-3">
                        {p.is_active ? <Badge tone="green">active</Badge> : <Badge tone="slate">retired</Badge>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(p)}>Edit</Button>
                          <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300" onClick={() => remove(p)}>Delete</Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="space-y-2 p-4">
              {hierarchy.roots.map((root) => {
                const children = hierarchy.byParent.get(root.id) ?? []
                return (
                  <div key={root.id} className="rounded-lg border border-slate-800 bg-slate-950/40">
                    <div className="flex items-center justify-between px-4 py-3">
                      <div className="flex items-center gap-3">
                        <button onClick={() => openDetail(root)} className="font-medium text-slate-100 hover:text-brand-300">{root.name}</button>
                        <span className="font-mono text-xs text-slate-500">{root.sku_code}</span>
                        {root.family && <Badge tone="blue">{root.family}</Badge>}
                        {!root.is_active && <Badge tone="slate">retired</Badge>}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-brand-300">{fmtUsd(root.default_expansion_arr_cents)}</span>
                        <Button size="sm" variant="ghost" onClick={() => openEdit(root)}>Edit</Button>
                      </div>
                    </div>
                    {children.length > 0 && (
                      <div className="space-y-1 border-t border-slate-800 px-4 py-2">
                        {children.map((c) => (
                          <div key={c.id} className="flex items-center justify-between rounded-md px-3 py-1.5 hover:bg-slate-900/60">
                            <div className="flex items-center gap-2">
                              <span className="text-slate-600">↳</span>
                              <button onClick={() => openDetail(c)} className="text-sm text-slate-200 hover:text-brand-300">{c.name}</button>
                              <span className="font-mono text-xs text-slate-500">{c.sku_code}</span>
                            </div>
                            <span className="text-xs text-brand-300">{fmtUsd(c.default_expansion_arr_cents)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Create / edit modal */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Edit product' : 'New product'}
        className="max-w-xl"
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving || !form.sku_code || !form.name}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="SKU code">
            <input className={inputCls} value={form.sku_code} onChange={(e) => setForm({ ...form, sku_code: e.target.value })} />
          </Field>
          <Field label="Name">
            <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Family">
            <input className={inputCls} value={form.family} onChange={(e) => setForm({ ...form, family: e.target.value })} />
          </Field>
          <Field label="Category">
            <input className={inputCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          </Field>
          <Field label="Type">
            <select className={inputCls} value={form.product_type} onChange={(e) => setForm({ ...form, product_type: e.target.value })}>
              <option value="platform">platform</option>
              <option value="module">module</option>
              <option value="add-on">add-on</option>
              <option value="service">service</option>
            </select>
          </Field>
          <Field label="Parent product">
            <select className={inputCls} value={form.parent_product_id} onChange={(e) => setForm({ ...form, parent_product_id: e.target.value })}>
              <option value="">— none (top-level) —</option>
              {products
                .filter((p) => !editing || p.id !== editing.id)
                .map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
            </select>
          </Field>
          <Field label="Default expansion ARR (USD)">
            <input type="number" className={inputCls} value={form.default_expansion_arr_cents} onChange={(e) => setForm({ ...form, default_expansion_arr_cents: e.target.value })} />
          </Field>
          <Field label="Status">
            <label className="flex h-[38px] items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
              Active
            </label>
          </Field>
          <Field label="Description" className="col-span-2">
            <textarea className={inputCls} rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
        </div>
      </Modal>

      {/* Detail modal */}
      <Modal open={detailOpen} onClose={() => setDetailOpen(false)} title="Product detail" className="max-w-xl">
        {detailLoading || !detail ? (
          <Spinner label="Loading…" className="py-8" />
        ) : (
          <div className="space-y-4">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold text-white">{detail.product.name}</h3>
                {detail.product.is_active ? <Badge tone="green">active</Badge> : <Badge tone="slate">retired</Badge>}
              </div>
              <p className="mt-1 font-mono text-xs text-slate-500">{detail.product.sku_code}</p>
              {detail.product.description && <p className="mt-2 text-sm text-slate-400">{detail.product.description}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Info label="Family" value={detail.product.family} />
              <Info label="Category" value={detail.product.category} />
              <Info label="Type" value={detail.product.product_type} />
              <Info label="Default ARR" value={fmtUsd(detail.product.default_expansion_arr_cents)} />
            </div>
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Child modules ({detail.modules.length})</div>
              {detail.modules.length === 0 ? (
                <p className="text-sm text-slate-500">No child modules.</p>
              ) : (
                <div className="space-y-1">
                  {detail.modules.map((m) => (
                    <div key={m.id} className="flex items-center justify-between rounded-md bg-slate-950/60 px-3 py-1.5 text-sm">
                      <span className="text-slate-200">{m.name}</span>
                      <span className="text-xs text-brand-300">{fmtUsd(m.default_expansion_arr_cents)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex justify-end">
              <Button variant="secondary" onClick={() => { setDetailOpen(false); openEdit(detail.product) }}>Edit product</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Import modal */}
      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import catalog rows"
        className="max-w-xl"
        footer={
          <>
            <Button variant="ghost" onClick={fillSampleImport}>Sample</Button>
            <Button variant="secondary" onClick={() => setImportOpen(false)}>Close</Button>
            <Button onClick={runImport} disabled={importing || !importText.trim()}>
              {importing ? 'Importing…' : 'Run import'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-400">Paste a JSON array of product rows (sku_code, name, family, category, product_type, default_expansion_arr_cents).</p>
          <textarea
            className="h-48 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-100 outline-none focus:border-brand-500"
            placeholder='[{"sku_code":"CORE","name":"Core Platform"}]'
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
          />
          {importResult && (
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm">
              <span className="text-emerald-300">Imported {importResult.imported}</span>
              {Array.isArray(importResult.errors) && importResult.errors.length > 0 && (
                <span className="ml-3 text-amber-300">{importResult.errors.length} errors</span>
              )}
            </div>
          )}
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

function Info({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-sm text-slate-200">{value || '—'}</div>
    </div>
  )
}
