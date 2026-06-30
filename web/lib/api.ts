// Same-origin relative calls to /api/proxy/* — the proxy route injects X-User-Id
// and forwards 1:1 to the backend /api/v1/* surface. Every method here maps to
// exactly one endpoint in the build contract.

type Params = Record<string, string | number | boolean | undefined | null>

function qs(params?: Params): string {
  if (!params) return ''
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

async function http(path: string, init?: RequestInit) {
  const res = await fetch(`/api/proxy/${path}`, init)
  const text = await res.text()
  let data: any = null
  if (text) {
    try { data = JSON.parse(text) } catch { data = text }
  }
  if (!res.ok) {
    const message = (data && (data.error || data.message)) || `Request failed (${res.status})`
    throw new Error(message)
  }
  return data
}

const get = (path: string) => http(path)
const post = (path: string, body?: unknown) =>
  http(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const put = (path: string, body?: unknown) =>
  http(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
const del = (path: string) => http(path, { method: 'DELETE' })

const api = {
  // accounts
  listAccounts: (params?: Params) => get(`accounts${qs(params)}`),
  getAccount: (id: string) => get(`accounts/${id}`),
  createAccount: (body: unknown) => post('accounts', body),
  updateAccount: (id: string, body: unknown) => put(`accounts/${id}`, body),
  deleteAccount: (id: string) => del(`accounts/${id}`),

  // products
  listProducts: (params?: Params) => get(`products${qs(params)}`),
  getProduct: (id: string) => get(`products/${id}`),
  createProduct: (body: unknown) => post('products', body),
  updateProduct: (id: string, body: unknown) => put(`products/${id}`, body),
  deleteProduct: (id: string) => del(`products/${id}`),
  importProducts: (body: unknown) => post('products/import', body),

  // price book
  listPriceBook: (params?: Params) => get(`price-book${qs(params)}`),
  createPriceEntry: (body: unknown) => post('price-book', body),
  updatePriceEntry: (id: string, body: unknown) => put(`price-book/${id}`, body),
  deletePriceEntry: (id: string) => del(`price-book/${id}`),

  // ownership
  listOwnership: (params?: Params) => get(`ownership${qs(params)}`),
  upsertOwnership: (body: unknown) => post('ownership', body),
  deleteOwnership: (id: string) => del(`ownership/${id}`),
  importOwnership: (body: unknown) => post('ownership/import', body),

  // seats
  listSeats: (params?: Params) => get(`seats${qs(params)}`),
  listSeatOverage: () => get('seats/overage'),
  upsertSeat: (body: unknown) => post('seats', body),
  importSeats: (body: unknown) => post('seats/import', body),

  // eligibility
  listRules: () => get('eligibility/rules'),
  createRule: (body: unknown) => post('eligibility/rules', body),
  updateRule: (id: string, body: unknown) => put(`eligibility/rules/${id}`, body),
  deleteRule: (id: string) => del(`eligibility/rules/${id}`),
  previewRule: (id: string) => post(`eligibility/rules/${id}/preview`),
  applyEligibility: () => post('eligibility/apply'),

  // grid
  getGrid: (params?: Params) => get(`grid${qs(params)}`),
  getGridCell: (accountId: string, productId: string) => get(`grid/cell${qs({ account_id: accountId, product_id: productId })}`),

  // sizing
  listSizing: (params?: Params) => get(`sizing${qs(params)}`),
  getSizingRollups: () => get('sizing/rollups'),
  computeSizing: (body: unknown) => post('sizing/compute', body),

  // lookalikes
  listLookalikes: (params?: Params) => get(`lookalikes${qs(params)}`),
  computeLookalikes: () => post('lookalikes/compute'),

  // plays
  listPlays: (params?: Params) => get(`plays${qs(params)}`),
  getPlay: (id: string) => get(`plays/${id}`),
  createPlay: (body: unknown) => post('plays', body),
  updatePlay: (id: string, body: unknown) => put(`plays/${id}`, body),
  transitionPlay: (id: string, stage: string) => post(`plays/${id}/stage`, { stage }),
  addPlayActivity: (id: string, body: unknown) => post(`plays/${id}/activities`, body),
  deletePlay: (id: string) => del(`plays/${id}`),
  bulkPlaysFromWhitespace: (body: unknown) => post('plays/bulk-from-whitespace', body),

  // heatmap
  getHeatmap: () => get('heatmap'),
  getHeatmapCell: (segment: string, productId: string) => get(`heatmap/cell${qs({ segment, product_id: productId })}`),

  // books
  listBooks: () => get('books'),
  getBookLeaderboard: () => get('books/leaderboard'),

  // snapshots
  listSnapshots: () => get('snapshots'),
  createSnapshot: (body: unknown) => post('snapshots', body),
  compareSnapshots: (a: string, b: string) => get(`snapshots/compare${qs({ a, b })}`),
  deleteSnapshot: (id: string) => del(`snapshots/${id}`),

  // segments
  listSegments: () => get('segments'),
  createSegment: (body: unknown) => post('segments', body),
  updateSegment: (id: string, body: unknown) => put(`segments/${id}`, body),
  deleteSegment: (id: string) => del(`segments/${id}`),
  getSegmentMembers: (id: string) => get(`segments/${id}/members`),

  // targets
  listTargets: () => get('targets'),
  createTarget: (body: unknown) => post('targets', body),
  updateTarget: (id: string, body: unknown) => put(`targets/${id}`, body),
  deleteTarget: (id: string) => del(`targets/${id}`),

  // analytics
  getPipelineAnalytics: () => get('analytics/pipeline'),
  getConversionAnalytics: () => get('analytics/conversion'),

  // launch planner
  modelLaunch: (body: unknown) => post('launch-planner/model', body),

  // notifications
  listNotifications: () => get('notifications'),
  markNotificationRead: (id: string) => post(`notifications/${id}/read`),
  markAllNotificationsRead: () => post('notifications/read-all'),
  listTriggers: () => get('notifications/triggers'),
  createTrigger: (body: unknown) => post('notifications/triggers', body),
  deleteTrigger: (id: string) => del(`notifications/triggers/${id}`),

  // saved views
  listSavedViews: (params?: Params) => get(`saved-views${qs(params)}`),
  createSavedView: (body: unknown) => post('saved-views', body),
  deleteSavedView: (id: string) => del(`saved-views/${id}`),

  // imports
  listImportJobs: () => get('imports'),
  runImport: (body: unknown) => post('imports', body),

  // audit
  listAudit: (params?: Params) => get(`audit${qs(params)}`),

  // qbr
  listQbrExports: () => get('qbr'),
  generateQbr: (accountId: string) => post(`qbr/${accountId}`),
  getQbrExport: (id: string) => get(`qbr/${id}`),

  // settings
  getSettings: () => get('settings'),
  updateSettings: (body: unknown) => put('settings', body),

  // overview
  getOverview: () => get('overview'),

  // seed
  seedSampleData: () => post('seed'),
  resetSampleData: () => post('seed/reset'),

  // billing
  getBillingPlan: () => get('billing/plan'),
  startCheckout: () => post('billing/checkout'),
  openBillingPortal: () => post('billing/portal'),
}

export default api
