import { and, eq, gt, lt, sql } from 'drizzle-orm'
import * as schema from '../../db/schema'
import { getAppSession } from '../../utils/app-session'
import { useDb } from '../../utils/db'

const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000
const ATTEMPT_RETENTION_MS = 24 * 60 * 60 * 1000

/** Constant-time comparison via SHA-256 digests (equal length by construction). */
async function pinMatches(provided: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder()
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(provided)),
    crypto.subtle.digest('SHA-256', enc.encode(expected))
  ])
  const va = new Uint8Array(a)
  const vb = new Uint8Array(b)
  let diff = 0
  for (let i = 0; i < va.length; i++) {
    diff |= va[i]! ^ vb[i]!
  }
  return diff === 0
}

/**
 * POST /api/auth/login { pin } — verifies the PIN, rate-limited to
 * 5 failures / 15 min per IP (persisted in auth_attempts, Serverless-safe).
 */
export default defineEventHandler(async (event) => {
  const { auth } = useRuntimeConfig()
  if (!auth.appPin || !auth.sessionSecret) {
    setResponseStatus(event, 503)
    return { success: false as const, data: null, error: 'Authentication is not configured on this deployment' }
  }

  const db = useDb()
  const now = Date.now()
  const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'

  // Opportunistic cleanup keeps the table tiny
  await db.delete(schema.authAttempts).where(lt(schema.authAttempts.ts, now - ATTEMPT_RETENTION_MS))

  const failed = await db.select({ n: sql<number>`count(*)` })
    .from(schema.authAttempts)
    .where(and(
      eq(schema.authAttempts.ip, ip),
      eq(schema.authAttempts.success, false),
      gt(schema.authAttempts.ts, now - LOCKOUT_WINDOW_MS)
    ))
    .get()

  if ((failed?.n ?? 0) >= MAX_FAILED_ATTEMPTS) {
    setResponseStatus(event, 429)
    return { success: false as const, data: null, error: 'Too many attempts — try again in 15 minutes' }
  }

  const body = await readBody<{ pin?: string }>(event).catch(() => null)
  const pin = typeof body?.pin === 'string' ? body.pin.trim() : ''
  const ok = pin.length > 0 && await pinMatches(pin, auth.appPin)

  await db.insert(schema.authAttempts).values({ ip, ts: now, success: ok })

  if (!ok) {
    setResponseStatus(event, 401)
    const remaining = MAX_FAILED_ATTEMPTS - (failed?.n ?? 0) - 1
    return { success: false as const, data: null, error: `Incorrect PIN (${Math.max(remaining, 0)} attempts left)` }
  }

  const session = await getAppSession(event)
  await session.update({ authed: true, at: now })
  return { success: true as const, data: { authed: true }, error: null }
})
