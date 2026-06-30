// ---------------------------------------------------------------------------
// cron.ts — self-contained scheduling engine
//
// Pure, deterministic helpers for validating / describing schedule expressions,
// projecting future firings, and analysing collisions, load, DST traps, coverage
// gaps and auto-spread suggestions. No external services, no DB access. Every
// function is a referentially-transparent computation over its inputs so it can
// be unit-tested and reused freely by route handlers.
// ---------------------------------------------------------------------------

import { CronExpressionParser } from 'cron-parser'

export type ScheduleKind = 'cron' | 'rate' | 'oneoff'

export interface ScheduledJob {
  id: string
  kind: ScheduleKind
  expr: string
  timezone?: string
  resourceId?: string | null
}

export interface ValidationResult {
  valid: boolean
  error?: string
}

export interface CollisionWindow {
  windowStart: string
  windowEnd: string
  jobIds: string[]
  severity: 'low' | 'medium' | 'high'
  resourceId?: string
}

export interface HeatmapBucket {
  bucket: string
  count: number
}

export interface DstTrap {
  type: 'double_fire' | 'skip' | 'ambiguous'
  atLocal: string
  atUtc: string
}

export interface CoverageGap {
  windowStart: string
  windowEnd: string
  gapMs: number
}

export interface SpreadSuggestion {
  jobId: string
  suggestedExpr: string
  reason: string
}

// ---------------------------------------------------------------------------
// internal helpers
// ---------------------------------------------------------------------------

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

// Parse a "rate" expression: "every N minutes|hours|days" (N optional => 1).
function parseRate(expr: string): { intervalMs: number } | null {
  const m = expr
    .trim()
    .toLowerCase()
    .match(/^every\s+(?:(\d+)\s+)?(minute|hour|day)s?$/)
  if (!m) return null
  const n = m[1] ? parseInt(m[1], 10) : 1
  if (!Number.isFinite(n) || n <= 0) return null
  const unit = m[2]
  const unitMs = unit === 'minute' ? MINUTE_MS : unit === 'hour' ? HOUR_MS : DAY_MS
  return { intervalMs: n * unitMs }
}

// Truncate an ISO instant to the start of its minute (UTC) — used for bucketing.
function floorToMinuteIso(iso: string): string {
  const d = new Date(iso)
  d.setUTCSeconds(0, 0)
  return d.toISOString()
}

// Offset (in minutes) of a given instant in a given IANA timezone.
function tzOffsetMinutes(date: Date, timezone: string): number {
  // Render the same instant once as UTC and once in the target zone, then diff.
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = dtf.formatToParts(date)
  const map: Record<string, string> = {}
  for (const p of parts) map[p.type] = p.value
  let hour = parseInt(map.hour, 10)
  if (hour === 24) hour = 0
  const asUTC = Date.UTC(
    parseInt(map.year, 10),
    parseInt(map.month, 10) - 1,
    parseInt(map.day, 10),
    hour,
    parseInt(map.minute, 10),
    parseInt(map.second, 10),
  )
  return Math.round((asUTC - date.getTime()) / MINUTE_MS)
}

// ---------------------------------------------------------------------------
// validateExpression
// ---------------------------------------------------------------------------

export function validateExpression(kind: ScheduleKind, expr: string): ValidationResult {
  if (!expr || !expr.trim()) return { valid: false, error: 'Expression is empty' }
  switch (kind) {
    case 'cron': {
      try {
        CronExpressionParser.parse(expr)
        return { valid: true }
      } catch (e) {
        return { valid: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
    case 'rate': {
      const r = parseRate(expr)
      return r
        ? { valid: true }
        : { valid: false, error: 'Expected "every N minutes|hours|days"' }
    }
    case 'oneoff': {
      const t = Date.parse(expr)
      return Number.isNaN(t)
        ? { valid: false, error: 'Not a parseable ISO timestamp' }
        : { valid: true }
    }
    default:
      return { valid: false, error: `Unknown kind: ${kind}` }
  }
}

// ---------------------------------------------------------------------------
// describeExpression
// ---------------------------------------------------------------------------

export function describeExpression(
  kind: ScheduleKind,
  expr: string,
  timezone = 'UTC',
): string {
  const v = validateExpression(kind, expr)
  if (!v.valid) return `Invalid ${kind} expression: ${v.error}`
  switch (kind) {
    case 'cron':
      return `Cron "${expr}" in ${timezone}`
    case 'rate': {
      const r = parseRate(expr)!
      const mins = r.intervalMs / MINUTE_MS
      if (mins % (60 * 24) === 0) return `Every ${mins / (60 * 24)} day(s)`
      if (mins % 60 === 0) return `Every ${mins / 60} hour(s)`
      return `Every ${mins} minute(s)`
    }
    case 'oneoff':
      return `Once at ${new Date(expr).toISOString()}`
    default:
      return expr
  }
}

// ---------------------------------------------------------------------------
// nextFirings
// ---------------------------------------------------------------------------

export function nextFirings(
  kind: ScheduleKind,
  expr: string,
  timezone = 'UTC',
  fromISO: string = new Date().toISOString(),
  count = 10,
): string[] {
  if (!validateExpression(kind, expr).valid) return []
  const from = new Date(fromISO)
  const n = Math.max(0, Math.floor(count))
  if (n === 0) return []

  switch (kind) {
    case 'cron': {
      const out: string[] = []
      try {
        const it = CronExpressionParser.parse(expr, { tz: timezone, currentDate: from })
        for (let i = 0; i < n; i++) {
          out.push(it.next().toDate().toISOString())
        }
      } catch {
        return out
      }
      return out
    }
    case 'rate': {
      const r = parseRate(expr)
      if (!r) return []
      const out: string[] = []
      let t = from.getTime() + r.intervalMs
      for (let i = 0; i < n; i++) {
        out.push(new Date(t).toISOString())
        t += r.intervalMs
      }
      return out
    }
    case 'oneoff': {
      const t = Date.parse(expr)
      if (Number.isNaN(t) || t <= from.getTime()) return []
      return [new Date(t).toISOString()]
    }
    default:
      return []
  }
}

// ---------------------------------------------------------------------------
// computeCollisions
// ---------------------------------------------------------------------------

export function computeCollisions(
  jobs: ScheduledJob[],
  opts: { horizonDays: number; threshold: number },
): CollisionWindow[] {
  const horizonDays = opts.horizonDays > 0 ? opts.horizonDays : 7
  const threshold = opts.threshold > 0 ? opts.threshold : 2
  const fromISO = new Date().toISOString()
  const fromMs = Date.parse(fromISO)
  const horizonMs = fromMs + horizonDays * DAY_MS

  // Bucket every firing by minute. Track which jobs fire in each minute.
  const byMinute = new Map<string, { jobIds: Set<string>; resources: Map<string, Set<string>> }>()

  for (const job of jobs) {
    // Project plenty of firings, then clip to horizon.
    const firings = nextFirings(job.kind, job.expr, job.timezone ?? 'UTC', fromISO, 2000)
    for (const f of firings) {
      const ms = Date.parse(f)
      if (ms > horizonMs) break
      const minute = floorToMinuteIso(f)
      let entry = byMinute.get(minute)
      if (!entry) {
        entry = { jobIds: new Set(), resources: new Map() }
        byMinute.set(minute, entry)
      }
      entry.jobIds.add(job.id)
      if (job.resourceId) {
        let set = entry.resources.get(job.resourceId)
        if (!set) {
          set = new Set()
          entry.resources.set(job.resourceId, set)
        }
        set.add(job.id)
      }
    }
  }

  const windows: CollisionWindow[] = []
  for (const [minute, entry] of byMinute) {
    const concurrency = entry.jobIds.size
    // Find the resource (if any) most contended in this minute.
    let contendedResource: string | undefined
    let resourceContention = 0
    for (const [rid, set] of entry.resources) {
      if (set.size >= 2 && set.size > resourceContention) {
        resourceContention = set.size
        contendedResource = rid
      }
    }
    const flagged = concurrency >= threshold || resourceContention >= 2
    if (!flagged) continue
    const peak = Math.max(concurrency, resourceContention)
    const severity: CollisionWindow['severity'] =
      peak >= threshold + 3 ? 'high' : peak >= threshold + 1 ? 'medium' : 'low'
    const windowStart = minute
    const windowEnd = new Date(Date.parse(minute) + MINUTE_MS).toISOString()
    windows.push({
      windowStart,
      windowEnd,
      jobIds: Array.from(entry.jobIds).sort(),
      severity,
      ...(contendedResource ? { resourceId: contendedResource } : {}),
    })
  }

  windows.sort((a, b) => a.windowStart.localeCompare(b.windowStart))
  return windows
}

// ---------------------------------------------------------------------------
// loadHeatmap
// ---------------------------------------------------------------------------

export function loadHeatmap(
  jobs: ScheduledJob[],
  opts: { horizonDays: number },
): HeatmapBucket[] {
  const horizonDays = opts.horizonDays > 0 ? opts.horizonDays : 7
  const fromISO = new Date().toISOString()
  const fromMs = Date.parse(fromISO)
  const horizonMs = fromMs + horizonDays * DAY_MS

  // Bucket firings by hour-of-week (0..167) so the heatmap is dense and bounded.
  const counts = new Map<string, number>()
  for (const job of jobs) {
    const firings = nextFirings(job.kind, job.expr, job.timezone ?? 'UTC', fromISO, 5000)
    for (const f of firings) {
      const ms = Date.parse(f)
      if (ms > horizonMs) break
      const d = new Date(f)
      const bucket = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
        d.getUTCDate(),
      ).padStart(2, '0')}T${String(d.getUTCHours()).padStart(2, '0')}:00Z`
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1)
    }
  }

  return Array.from(counts.entries())
    .map(([bucket, count]) => ({ bucket, count }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket))
}

// ---------------------------------------------------------------------------
// dstTraps
// ---------------------------------------------------------------------------

export function dstTraps(
  kind: ScheduleKind,
  expr: string,
  timezone = 'UTC',
  fromISO: string = new Date().toISOString(),
  days = 365,
): DstTrap[] {
  if (timezone === 'UTC') return [] // UTC never shifts.
  if (!validateExpression(kind, expr).valid) return []

  const fromMs = Date.parse(fromISO)
  const toMs = fromMs + days * DAY_MS
  const traps: DstTrap[] = []

  // Walk day-by-day looking for offset changes; classify the transition.
  let prevOffset = tzOffsetMinutes(new Date(fromMs), timezone)
  for (let ms = fromMs + DAY_MS; ms <= toMs; ms += DAY_MS) {
    const d = new Date(ms)
    const offset = tzOffsetMinutes(d, timezone)
    if (offset === prevOffset) {
      prevOffset = offset
      continue
    }
    // Offset changed across this day. Spring-forward (offset increases) skips a
    // local hour; fall-back (offset decreases) repeats one (ambiguous + possible
    // double-fire for jobs that match the repeated wall-clock time).
    const atUtc = d.toISOString()
    const local = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d)
    if (offset > prevOffset) {
      traps.push({ type: 'skip', atLocal: local, atUtc })
    } else {
      traps.push({ type: 'double_fire', atLocal: local, atUtc })
      traps.push({ type: 'ambiguous', atLocal: local, atUtc })
    }
    prevOffset = offset
  }

  return traps
}

// ---------------------------------------------------------------------------
// coverageGaps
// ---------------------------------------------------------------------------

export function coverageGaps(
  windows: Array<{ start: string; end: string }>,
  jobs: ScheduledJob[],
  opts: { horizonDays: number },
): CoverageGap[] {
  const horizonDays = opts.horizonDays > 0 ? opts.horizonDays : 7
  const fromISO = new Date().toISOString()
  const fromMs = Date.parse(fromISO)
  const horizonMs = fromMs + horizonDays * DAY_MS

  // Required-coverage windows define spans that must contain at least one firing.
  // Any such window with zero firings inside it is reported as a gap. If no
  // windows are supplied, fall back to detecting large inter-firing gaps.
  const allFirings: number[] = []
  for (const job of jobs) {
    const firings = nextFirings(job.kind, job.expr, job.timezone ?? 'UTC', fromISO, 5000)
    for (const f of firings) {
      const ms = Date.parse(f)
      if (ms > horizonMs) break
      allFirings.push(ms)
    }
  }
  allFirings.sort((a, b) => a - b)

  const gaps: CoverageGap[] = []

  if (windows.length > 0) {
    for (const w of windows) {
      const ws = Date.parse(w.start)
      const we = Date.parse(w.end)
      if (Number.isNaN(ws) || Number.isNaN(we) || we <= ws) continue
      const covered = allFirings.some((f) => f >= ws && f <= we)
      if (!covered) {
        gaps.push({ windowStart: w.start, windowEnd: w.end, gapMs: we - ws })
      }
    }
    return gaps
  }

  // No explicit windows: flag inter-firing intervals larger than a day.
  let prev = fromMs
  for (const f of allFirings) {
    if (f - prev > DAY_MS) {
      gaps.push({
        windowStart: new Date(prev).toISOString(),
        windowEnd: new Date(f).toISOString(),
        gapMs: f - prev,
      })
    }
    prev = f
  }
  return gaps
}

// ---------------------------------------------------------------------------
// autoSpread
// ---------------------------------------------------------------------------

export function autoSpread(
  jobs: ScheduledJob[],
  opts: { threshold: number },
): SpreadSuggestion[] {
  const threshold = opts.threshold > 0 ? opts.threshold : 2
  const collisions = computeCollisions(jobs, { horizonDays: 1, threshold })
  const byId = new Map(jobs.map((j) => [j.id, j]))

  // For each collision window, keep the first job and nudge the rest off the
  // contended minute by adding a deterministic per-job minute offset.
  const suggestions = new Map<string, SpreadSuggestion>()
  for (const win of collisions) {
    win.jobIds.slice(1).forEach((jid, idx) => {
      if (suggestions.has(jid)) return
      const job = byId.get(jid)
      if (!job) return
      const offset = (idx + 1) % 60
      let suggestedExpr = job.expr
      if (job.kind === 'cron') {
        const parts = job.expr.trim().split(/\s+/)
        if (parts.length >= 5) {
          // Shift the minute field to a fixed staggered minute.
          parts[0] = String(offset)
          suggestedExpr = parts.join(' ')
        }
      } else if (job.kind === 'rate') {
        // Rate jobs can't be phase-shifted via expression alone; recommend a
        // small interval bump to de-sync from the colliding cohort.
        const r = parseRate(job.expr)
        if (r) {
          const mins = r.intervalMs / MINUTE_MS + 1
          suggestedExpr = `every ${mins} minutes`
        }
      }
      suggestions.set(jid, {
        jobId: jid,
        suggestedExpr,
        reason: `Collides with ${win.jobIds.length - 1} other job(s) at ${win.windowStart}${
          win.resourceId ? ` on resource ${win.resourceId}` : ''
        }; stagger to reduce concurrency below threshold ${threshold}.`,
      })
    })
  }

  return Array.from(suggestions.values())
}
