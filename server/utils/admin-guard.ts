import type { H3Event } from 'h3'

/**
 * Guards admin/ingest endpoints with the shared secret (NUXT_INGEST_SECRET).
 * In local dev an unset secret is allowed; in production the endpoints
 * refuse to work without one — no accidental open admin surface.
 */
export function requireSharedSecret(event: H3Event, headerName = 'x-admin-secret'): void {
  const { ingest } = useRuntimeConfig()
  const provided = getHeader(event, headerName)

  if (!ingest.secret) {
    if (import.meta.dev) {
      return
    }
    throw createError({ statusCode: 503, message: 'NUXT_INGEST_SECRET is not configured' })
  }
  if (provided !== ingest.secret) {
    throw createError({ statusCode: 401, message: 'Invalid or missing shared secret' })
  }
}
