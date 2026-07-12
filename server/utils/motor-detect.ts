/**
 * Motor run detection — source selection and the incremental power-signature
 * state machine.
 *
 * Preferred source: real switch on/off events (exact timestamps). While the
 * relay sits always-on ahead of a manual switchboard it produces none, so we
 * fall back to synthetic 'sig-on'/'sig-off' events derived in the poller by
 * watching the house baseline (breaker − plugs) for motor-sized power steps.
 * Signature runs are approximate (±poll-interval per edge) and are labeled
 * as such in the UI; push alerts only ever fire on real events.
 */
import { and, eq, gte, inArray } from 'drizzle-orm'
import * as schema from '../db/schema'
import type { Db } from './db'
import { buildSessions, MAX_SESSION_MS, type MotorSession } from './motor-sessions'
import { SIG_STEP_MAX_FACTOR, SIG_STEP_MIN_FACTOR } from './power-signature'

const SIG_STATE_PREFIX = 'sig_state:'

interface SigState {
  lastW: number
  openStart: number | null
}

/**
 * One poll tick of signature detection: compare this cycle's baseline watts
 * to the previous one and emit synthetic sig-on/sig-off device events on
 * motor-sized steps. Idempotent via the device_events UNIQUE constraint.
 */
export async function evaluateSignatureStep(
  db: Db,
  motorId: string,
  ratedWatts: number,
  baselineW: number,
  now: number
): Promise<void> {
  const key = SIG_STATE_PREFIX + motorId
  const row = await db.select().from(schema.syncState).where(eq(schema.syncState.key, key)).get()
  const state: SigState = row ? JSON.parse(row.value) : { lastW: baselineW, openStart: null }

  const delta = baselineW - state.lastW
  const minStep = ratedWatts * SIG_STEP_MIN_FACTOR
  const maxStep = ratedWatts * SIG_STEP_MAX_FACTOR
  let openStart = state.openStart

  if (openStart === null && delta >= minStep && delta <= maxStep) {
    await insertSigEvent(db, motorId, 'sig-on', now)
    openStart = now
  } else if (openStart !== null && -delta >= minStep && -delta <= maxStep) {
    await insertSigEvent(db, motorId, 'sig-off', now)
    openStart = null
  } else if (openStart !== null && now - openStart > MAX_SESSION_MS) {
    // No matching down-step within any plausible run — close it out; the
    // resulting over-long session is capped and excluded from estimates.
    await insertSigEvent(db, motorId, 'sig-off', now)
    openStart = null
  }

  const value = JSON.stringify({ lastW: baselineW, openStart } satisfies SigState)
  await db.insert(schema.syncState)
    .values({ key, value, updatedAt: now })
    .onConflictDoUpdate({ target: schema.syncState.key, set: { value, updatedAt: now } })
}

async function insertSigEvent(db: Db, deviceId: string, eventType: 'sig-on' | 'sig-off', eventTime: number): Promise<void> {
  await db.insert(schema.deviceEvents)
    .values({ deviceId, eventType, eventTime })
    .onConflictDoNothing()
}

export interface MotorDetectionResult {
  sessions: MotorSession[]
  /** 'events' = real switch transitions · 'signature' = approximate power-step inference */
  detection: 'events' | 'signature'
}

/**
 * Sessions for a motor device over [from, now], choosing the best available
 * source. Real events win when they contain anything usable — a closed
 * session, or an open one that isn't a stale always-on artifact.
 */
export async function getMotorSessions(
  db: Db,
  motorId: string,
  from: number,
  now: number
): Promise<MotorDetectionResult> {
  const fetchEvents = (types: string[]) => db.select()
    .from(schema.deviceEvents)
    .where(and(
      eq(schema.deviceEvents.deviceId, motorId),
      inArray(schema.deviceEvents.eventType, types),
      gte(schema.deviceEvents.eventTime, from - MAX_SESSION_MS)
    ))
    .limit(5000)
    .all()

  const real = await fetchEvents(['on', 'off'])
  const realSessions = buildSessions(real, now)
  if (realSessions.some(s => s.endTs !== null || !s.capped)) {
    return { sessions: realSessions, detection: 'events' }
  }

  const sig = await fetchEvents(['sig-on', 'sig-off'])
  const sigSessions = buildSessions(
    sig.map(e => ({ eventType: e.eventType === 'sig-on' ? 'on' : 'off', eventTime: e.eventTime })),
    now
  )
  return { sessions: sigSessions, detection: 'signature' }
}
