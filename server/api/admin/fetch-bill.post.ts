import { requireAuthOrSecret } from '../../utils/auth-guard'
import { syncBills } from '../../utils/bill-scraper'
import { useDb } from '../../utils/db'

/**
 * POST /api/admin/fetch-bill — scrape the PITC web bill and upsert the
 * current bill + 12-month history. Callable from the UI (session) or a
 * scheduler (x-admin-secret). Reference no comes from env, never the client.
 */
export default defineEventHandler(async (event) => {
  await requireAuthOrSecret(event)
  const { bill } = useRuntimeConfig()
  if (!bill.referenceNo) {
    setResponseStatus(event, 503)
    return { success: false as const, data: null, error: 'NUXT_BILL_REFERENCE_NO is not configured' }
  }
  const db = useDb()
  const summary = await syncBills(db, bill.referenceNo)
  return { success: true as const, data: summary, error: null }
})
