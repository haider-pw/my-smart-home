import { eq } from 'drizzle-orm'
import * as schema from '../../db/schema'
import { useDb } from '../../utils/db'
import { isR2Configured, r2Get } from '../../utils/r2'

/**
 * GET /api/bills/:month — streams the archived original bill (HTML or PDF)
 * from R2. Session-gated by the global middleware like every page.
 */
export default defineEventHandler(async (event) => {
  const month = getRouterParam(event, 'month') ?? ''
  if (!/^\d{4}-\d{2}$/.test(month)) {
    setResponseStatus(event, 400)
    return { success: false as const, data: null, error: 'month must be YYYY-MM' }
  }

  const db = useDb()
  const bill = await db.select().from(schema.bills).where(eq(schema.bills.billMonth, month)).get()
  if (!bill?.archiveKey) {
    setResponseStatus(event, 404)
    return { success: false as const, data: null, error: 'No archived document for this month' }
  }

  if (!isR2Configured()) {
    setResponseStatus(event, 503)
    return { success: false as const, data: null, error: 'Archive storage not configured — set the NUXT_R2_* environment variables' }
  }
  const object = await r2Get(bill.archiveKey)
  if (!object) {
    setResponseStatus(event, 404)
    return { success: false as const, data: null, error: 'Archive object missing from storage' }
  }

  setHeader(event, 'Content-Type', bill.archiveContentType ?? object.contentType)
  setHeader(event, 'Content-Disposition', `inline; filename="bill-${month}.${(bill.archiveContentType ?? '').includes('pdf') ? 'pdf' : 'html'}"`)
  setHeader(event, 'Cache-Control', 'private, max-age=3600')
  return object.body
})
