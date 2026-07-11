import { requireSharedSecret } from '../../utils/admin-guard'
import { syncBillsFromHtml } from '../../utils/bill-scraper'
import { useDb } from '../../utils/db'

const MAX_HTML_BYTES = 512 * 1024

/**
 * POST /api/admin/ingest-bill — body is raw PITC bill HTML, fetched by the
 * homelab (PITC geo-blocks foreign datacenter IPs, so Vercel cannot fetch it
 * directly). Shared-secret guarded; parsing/storage stays server-side.
 */
export default defineEventHandler(async (event) => {
  requireSharedSecret(event)
  const html = await readRawBody(event, 'utf8')
  if (!html || html.length < 500) {
    setResponseStatus(event, 400)
    return { success: false as const, data: null, error: 'Raw bill HTML body required' }
  }
  if (html.length > MAX_HTML_BYTES) {
    setResponseStatus(event, 413)
    return { success: false as const, data: null, error: 'Body too large' }
  }
  const db = useDb()
  try {
    const summary = await syncBillsFromHtml(db, html)
    return { success: true as const, data: summary, error: null }
  } catch (error: unknown) {
    const err = error as { statusCode?: number, message?: string }
    setResponseStatus(event, err.statusCode ?? 502)
    return { success: false as const, data: null, error: err.message ?? 'bill ingest failed' }
  }
})
