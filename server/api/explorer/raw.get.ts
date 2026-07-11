import { requireAuthOrSecret } from '../../utils/auth-guard'
import { tuyaGet } from '../../utils/tuya'
import type { TuyaQuery } from '../../utils/tuya-sign'

/** Read-only GET is allowed only under these API roots. */
const ALLOWED_PATH_PREFIXES = ['/v1.0/', '/v1.1/', '/v1.2/', '/v2.0/', '/v2.1/']

/**
 * GET /api/explorer/raw?path=/v1.0/... — signed read-only passthrough to the
 * Tuya API for exploring endpoints (statistics, logs) the UI doesn't cover.
 * Dev/diagnostic tool; sits behind the app-wide auth from Phase 2 onward.
 */
export default defineEventHandler(async (event) => {
  await requireAuthOrSecret(event)
  const { path, ...rest } = getQuery(event) as Record<string, string>

  if (!path || !ALLOWED_PATH_PREFIXES.some(p => path.startsWith(p))) {
    setResponseStatus(event, 400)
    return {
      success: false as const,
      data: null,
      error: `"path" query param is required and must start with one of: ${ALLOWED_PATH_PREFIXES.join(', ')}`
    }
  }

  const query: TuyaQuery = Object.fromEntries(
    Object.entries(rest).filter(([, v]) => v !== undefined && v !== '')
  )

  try {
    const result = await tuyaGet<unknown>(path, Object.keys(query).length > 0 ? query : undefined)
    return { success: true as const, data: result, error: null }
  } catch (error: unknown) {
    const err = error as { statusCode?: number, message?: string }
    setResponseStatus(event, err.statusCode ?? 502)
    return { success: false as const, data: null, error: err.message ?? 'Tuya request failed' }
  }
})
