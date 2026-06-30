'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Product {
  id: string
  sku_code?: string
  name: string
  category?: string | null
  family?: string | null
  product_type?: string | null
  is_active?: boolean
  default_expansion_arr_cents?: number | null
}

interface DimBucket {
  key: string
  label?: string
  accounts?: number
  count?: number
  arr_cents?: number
  addressable_arr_cents?: number
}

interface LaunchModel {
  addressable_arr_cents: number
  eligible_accounts: number
  byPre?: DimBucket[] | Record<string, number>
  byPost?: DimBucket[] | Record<string, number>
}

function fmtMoney(cents?: number | null): string {
  if (cents == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100)
}

function normalizeBuckets(b: DimBucket[] | Record<string, number> | undefined): DimBucket[] {
  if (!b) return []
  if (Array.isArray(b)) {
    return b.map((x) => ({
      key: x.key ?? x.label ?? '',
      label: x.label ?? x.key ?? '',
      accounts: x.accounts ?? x.count ?? 0,
      arr_cents: x.arr_cents ?? x.addressable_arr_cents ?? 0,
    }))
  }
  return Object.entries(b).map(([key, v]) => ({ key, label: key, arr_cents: typeof v === 'number' ? v : 0, accounts: 0 }))
}

export default function LaunchPlannerPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [targetProduct, setTargetProduct] = useState('')
  const [method, setMethod] = useState('default')
  const [adoptionAssumption, setAdoptionAssumption] = useState('50')

  const [modeling, setModeling] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)
  const [result, setResult] = useState<LaunchModel | null>(null)
  const [modeledProductId, setModeledProductId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const p = await api.listProducts()
      const list: Product[] = Array.isArray(p) ? p : []
      setProducts(list)
      if (list.length && !targetProduct) setTargetProduct(list[0].id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load products')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectedProduct = useMemo(() => products.find((p) => p.id === targetProduct) ?? null, [products, targetProduct])

  async function runModel() {
    if (!targetProduct) {
      setModelError('Select a target product to model.')
      return
    }
    setModeling(true)
    setModelError(null)
    try {
      const adoption = Number(adoptionAssumption)
      const res = await api.modelLaunch({
        target_product_id: targetProduct,
        method,
        adoption_rate: Number.isFinite(adoption) ? adoption / 100 : undefined,
      })
      setResult(res ?? null)
      setModeledProductId(targetProduct)
    } catch (e) {
      setModelError(e instanceof Error ? e.message : 'Failed to model launch')
      setResult(null)
    } finally {
      setModeling(false)
    }
  }

  const preBuckets = useMemo(() => normalizeBuckets(result?.byPre), [result])
  const postBuckets = useMemo(() => normalizeBuckets(result?.byPost), [result])

  const maxBucketArr = useMemo(
    () => Math.max(1, ...preBuckets.map((b) => b.arr_cents ?? 0), ...postBuckets.map((b) => b.arr_cents ?? 0)),
    [preBuckets, postBuckets],
  )

  if (loading) return <PageSpinner label="Loading launch planner…" />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Launch Planner</h1>
        <p className="mt-1 text-sm text-slate-400">
          Model a product launch: pick a target SKU and eligibility assumptions to size the addressable whitespace ARR across your base.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error} <button className="ml-2 underline" onClick={load}>Retry</button>
        </div>
      )}

      {products.length === 0 ? (
        <EmptyState
          title="No products in catalog"
          description="Add products to your catalog first, then return here to model the addressable whitespace of a launch."
        />
      ) : (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-white">Launch scenario</h2>
            <p className="mt-0.5 text-xs text-slate-500">Choose the product you are launching and how aggressively you expect it to land.</p>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-400">Target product <span className="text-red-400">*</span></span>
                <select
                  value={targetProduct}
                  onChange={(e) => setTargetProduct(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-purple-500 focus:outline-none"
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}{p.sku_code ? ` (${p.sku_code})` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-400">Sizing method</span>
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 capitalize focus:border-purple-500 focus:outline-none"
                >
                  <option value="default">Default (price book)</option>
                  <option value="seat_based">Seat based</option>
                  <option value="peer_adoption">Peer adoption</option>
                  <option value="flat">Flat expansion ARR</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-400">Adoption assumption (%)</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={adoptionAssumption}
                  onChange={(e) => setAdoptionAssumption(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-purple-500 focus:outline-none"
                />
              </label>
            </div>

            {selectedProduct && (
              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                {selectedProduct.family && <Badge tone="slate">Family: {selectedProduct.family}</Badge>}
                {selectedProduct.category && <Badge tone="slate">Category: {selectedProduct.category}</Badge>}
                {selectedProduct.default_expansion_arr_cents != null && (
                  <Badge tone="purple">Default expansion {fmtMoney(selectedProduct.default_expansion_arr_cents)}</Badge>
                )}
                {selectedProduct.is_active === false && <Badge tone="amber">Retired SKU</Badge>}
              </div>
            )}

            <div className="mt-5 flex items-center gap-3">
              <Button onClick={runModel} disabled={modeling}>{modeling ? 'Modeling…' : 'Model launch'}</Button>
              {modeling && <Spinner label="Sizing addressable whitespace…" />}
            </div>
            {modelError && <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{modelError}</p>}
          </CardBody>
        </Card>
      )}

      {result && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Stat
              label="Addressable whitespace ARR"
              value={fmtMoney(result.addressable_arr_cents)}
              tone="green"
              hint={modeledProductId === targetProduct ? 'Current scenario' : 'Re-run to refresh'}
            />
            <Stat label="Eligible accounts" value={(result.eligible_accounts ?? 0).toLocaleString()} tone="purple" />
            <Stat
              label="Avg ARR / account"
              value={result.eligible_accounts ? fmtMoney(Math.round(result.addressable_arr_cents / result.eligible_accounts)) : '—'}
            />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <BucketBreakdown title="Addressable by current state (pre-launch)" buckets={preBuckets} maxArr={maxBucketArr} />
            <BucketBreakdown title="Projected by state after launch (post)" buckets={postBuckets} maxArr={maxBucketArr} />
          </div>
        </>
      )}

      {!result && products.length > 0 && (
        <EmptyState
          title="No scenario modeled yet"
          description="Pick a target product and assumptions above, then run the model to size the addressable whitespace."
        />
      )}
    </div>
  )
}

function BucketBreakdown({ title, buckets, maxArr }: { title: string; buckets: { key: string; label?: string; accounts?: number; arr_cents?: number }[]; maxArr: number }) {
  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold text-white">{title}</h2>
      </CardHeader>
      <CardBody className="p-0">
        {buckets.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-slate-500">No breakdown returned for this dimension.</div>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Segment</TH>
                <TH className="text-right">Accounts</TH>
                <TH>Addressable ARR</TH>
              </TR>
            </THead>
            <TBody>
              {buckets.map((b) => {
                const arr = b.arr_cents ?? 0
                const w = Math.round((arr / maxArr) * 100)
                return (
                  <TR key={b.key}>
                    <TD className="font-medium text-white">{b.label || b.key || '—'}</TD>
                    <TD className="text-right tabular-nums text-slate-300">{(b.accounts ?? 0).toLocaleString()}</TD>
                    <TD>
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-28 overflow-hidden rounded-full bg-slate-800">
                          <div className="h-full bg-purple-500" style={{ width: `${Math.max(2, w)}%` }} />
                        </div>
                        <span className="tabular-nums text-emerald-300">{fmtMoney(arr)}</span>
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
  )
}
