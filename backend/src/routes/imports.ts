import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  import_jobs,
  accounts,
  products,
  price_book,
  ownership,
  seat_usage,
  audit_log,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// Supported import targets and the columns each accepts. Field mapping renames
// incoming row keys onto these canonical columns; everything else is ignored.
const ENTITY_COLUMNS: Record<string, { table: any; string: string[]; int: string[]; bool: string[]; required: string[] }> = {
  accounts: {
    table: accounts,
    string: ['external_id', 'name', 'segment', 'industry', 'region', 'employee_band', 'plan_tier', 'csm_owner'],
    int: ['current_arr_cents'],
    bool: [],
    required: ['name'],
  },
  products: {
    table: products,
    string: ['sku_code', 'name', 'description', 'category', 'family', 'product_type', 'parent_product_id'],
    int: ['default_expansion_arr_cents'],
    bool: ['is_active'],
    required: ['sku_code', 'name'],
  },
  price_book: {
    table: price_book,
    string: ['product_id', 'segment', 'currency', 'term'],
    int: ['list_price_cents', 'per_seat_cents', 'seat_band_min', 'seat_band_max'],
    bool: ['is_active'],
    required: ['product_id'],
  },
  ownership: {
    table: ownership,
    string: ['account_id', 'product_id'],
    int: ['quantity', 'owned_arr_cents'],
    bool: [],
    required: ['account_id', 'product_id'],
  },
  seat_usage: {
    table: seat_usage,
    string: ['account_id', 'product_id'],
    int: ['licensed_seats', 'active_seats', 'assigned_seats'],
    bool: [],
    required: ['account_id', 'product_id'],
  },
}

const importSchema = z.object({
  entity: z.string().min(1),
  rows: z.array(z.record(z.string(), z.unknown())).default([]),
  mapping: z.record(z.string(), z.string()).default({}),
})

function coerceInt(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseInt(String(v).replace(/[, ]/g, ''), 10)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

function coerceBool(v: unknown): boolean | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'boolean') return v
  const s = String(v).trim().toLowerCase()
  if (['true', '1', 'yes', 'y', 't'].includes(s)) return true
  if (['false', '0', 'no', 'n', 'f'].includes(s)) return false
  return null
}

// Public: list import jobs for the current user.
router.get('/', async (c) => {
  const userId = getUserId(c)
  const rows = userId
    ? await db
        .select()
        .from(import_jobs)
        .where(eq(import_jobs.user_id, userId))
        .orderBy(desc(import_jobs.created_at))
    : []
  return c.json(rows)
})

// Auth-gated: run an import. Applies field mapping, validates required fields,
// inserts/upserts each row, and records error rows + a job record.
router.post('/', authMiddleware, zValidator('json', importSchema), async (c) => {
  const userId = getUserId(c)
  const { entity, rows, mapping } = c.req.valid('json')

  const spec = ENTITY_COLUMNS[entity]
  if (!spec) {
    return c.json(
      { error: `Unsupported entity: ${entity}. Supported: ${Object.keys(ENTITY_COLUMNS).join(', ')}` },
      400,
    )
  }

  const errors: Array<Record<string, unknown>> = []
  let imported = 0

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i]
    // Apply mapping: { incomingKey: canonicalColumn }. Unmapped keys pass through
    // if they already match a canonical column name.
    const mapped: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(raw)) {
      const target = mapping[k] ?? k
      mapped[target] = v
    }

    const values: Record<string, unknown> = { user_id: userId }
    for (const col of spec.string) {
      if (mapped[col] !== undefined && mapped[col] !== null && mapped[col] !== '') {
        values[col] = String(mapped[col])
      }
    }
    for (const col of spec.int) {
      const n = coerceInt(mapped[col])
      if (n !== null) values[col] = n
    }
    for (const col of spec.bool) {
      const b = coerceBool(mapped[col])
      if (b !== null) values[col] = b
    }

    const missing = spec.required.filter(
      (r) => values[r] === undefined || values[r] === null || values[r] === '',
    )
    if (missing.length) {
      errors.push({ row: i, error: `Missing required field(s): ${missing.join(', ')}`, data: raw })
      continue
    }

    try {
      // Upsert on the entity's natural unique key where one exists.
      let conflictTarget: any[] | null = null
      if (entity === 'accounts') conflictTarget = [accounts.user_id, accounts.external_id]
      else if (entity === 'products') conflictTarget = [products.user_id, products.sku_code]
      else if (entity === 'ownership') conflictTarget = [ownership.account_id, ownership.product_id]
      else if (entity === 'seat_usage') conflictTarget = [seat_usage.account_id, seat_usage.product_id]

      if (conflictTarget) {
        const setObj: Record<string, unknown> = { ...values }
        delete setObj.user_id
        await db
          .insert(spec.table)
          .values(values as any)
          .onConflictDoUpdate({ target: conflictTarget as any, set: setObj as any })
      } else {
        await db.insert(spec.table).values(values as any)
      }
      imported++
    } catch (e) {
      errors.push({ row: i, error: e instanceof Error ? e.message : String(e), data: raw })
    }
  }

  const [job] = await db
    .insert(import_jobs)
    .values({
      user_id: userId,
      entity,
      status: errors.length === rows.length && rows.length > 0 ? 'failed' : 'completed',
      row_count: rows.length,
      error_count: errors.length,
      errors,
    })
    .returning()

  await db.insert(audit_log).values({
    user_id: userId,
    entity: 'import_job',
    entity_id: job.id,
    action: 'import',
    detail: { entity, imported, errors: errors.length },
  })

  return c.json(job, 201)
})

export default router
