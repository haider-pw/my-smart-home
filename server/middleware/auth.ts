import { isSessionAuthed } from '../utils/app-session'
import { getClientIp } from '../utils/client-ip'
import { isIpAllowed } from '../utils/ip-match'

/**
 * Global access gate:
 *   1. Requests from allowlisted IPs (NUXT_AUTH_ALLOWED_IPS) pass straight through.
 *   2. Otherwise a valid PIN session (signed cookie) is required.
 *   3. No session → API calls get 401 JSON; page loads redirect to /login.
 *
 * Auth is enforced only when BOTH NUXT_AUTH_APP_PIN and
 * NUXT_AUTH_SESSION_SECRET are configured — an unconfigured deployment stays
 * open rather than locking its owner out (the README documents this loudly).
 *
 * Machine-to-machine routes are exempt — they carry their own shared-secret
 * guard (requireSharedSecret / requireAuthOrSecret) and must keep working
 * when no browser session exists (external cron, homelab relay).
 */

const EXEMPT_PREFIXES = [
  '/login',
  '/api/auth/',
  '/api/admin/', // shared-secret guarded
  '/api/ingest', // shared-secret guarded
  '/_nuxt/',
  '/__nuxt',
  '/_vercel',
  '/favicon',
  '/icons/',
  '/manifest.webmanifest',
  '/robots.txt',
  '/sw.js',
  '/workbox-'
]

export default defineEventHandler(async (event) => {
  const path = event.path

  if (EXEMPT_PREFIXES.some(prefix => path.startsWith(prefix))) {
    return
  }

  const { auth } = useRuntimeConfig()
  if (!auth.appPin || !auth.sessionSecret) {
    return // auth not configured — open (dev default)
  }

  const visitorIp = getClientIp(event)
  if (isIpAllowed(visitorIp, auth.allowedIps)) {
    return
  }

  if (await isSessionAuthed(event)) {
    return
  }

  if (path.startsWith('/api/')) {
    throw createError({ statusCode: 401, message: 'Authentication required' })
  }
  return sendRedirect(event, '/login', 302)
})
