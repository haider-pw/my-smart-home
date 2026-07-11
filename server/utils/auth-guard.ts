import type { H3Event } from 'h3'
import { isSessionAuthed } from './app-session'
import { isIpAllowed } from './ip-match'

/**
 * For endpoints used by BOTH the browser (explorer UI) and machines
 * (debug tooling): a PIN session, an allowlisted IP, or the shared secret
 * all grant access. Falls back to requireSharedSecret semantics otherwise.
 */
export async function requireAuthOrSecret(event: H3Event): Promise<void> {
  const { auth, ingest } = useRuntimeConfig()

  if (auth.appPin && auth.sessionSecret) {
    if (await isSessionAuthed(event)) {
      return
    }
    const visitorIp = getRequestIP(event, { xForwardedFor: true })
    if (isIpAllowed(visitorIp, auth.allowedIps)) {
      return
    }
  }

  const provided = getHeader(event, 'x-admin-secret')
  if (ingest.secret && provided === ingest.secret) {
    return
  }

  if (!ingest.secret && !auth.appPin && import.meta.dev) {
    return // fully unconfigured local dev
  }

  throw createError({ statusCode: 401, message: 'Authentication required' })
}
