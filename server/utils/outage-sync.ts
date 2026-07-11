/**
 * Outage reconstruction from Tuya's server-side logs — the single source of
 * truth for the outage table.
 *
 * Tuya records device online/offline transitions with exact timestamps
 * regardless of whether OUR poller was running. Sweeping a trailing window
 * every poll makes the outage log immune to missed polls (homelab cron down,
 * PTCL outage, deploy gap): whatever was missed is reconstructed on the next
 * successful poll. All writes are idempotent, so overlapping sweeps are free.
 */
import { classifyOutage, OUTAGE_MIN_DURATION_MS, registerDelta } from './energy-math'
import * as schema from '../db/schema'
import type { Db } from './db'
import { fetchConnectivityEvents, fetchReportLogs } from './tuya-logs'

export interface OutageSyncResult {
  connectivityEvents: number
  outages: number
  insertedOutages: Array<{ startTs: number, durationMin: number, kind: 'power' | 'internet' | 'unknown' }>
}

function registerAround(series: Array<{ ts: number, kwh: number }>, ts: number, side: 'before' | 'after'): number | null {
  let best: { ts: number, kwh: number } | null = null
  for (const point of series) {
    if (side === 'before' ? point.ts <= ts : point.ts >= ts) {
      if (!best || (side === 'before' ? point.ts > best.ts : point.ts < best.ts)) {
        best = point
      }
    }
  }
  return best?.kwh ?? null
}

/**
 * Sweep [from, to]: import connectivity events, pair offline→online windows
 * ≥ the debounce threshold, classify power-vs-internet via the register.
 */
export async function syncBreakerOutages(
  db: Db,
  breakerId: string,
  from: number,
  to: number
): Promise<OutageSyncResult> {
  const result: OutageSyncResult = { connectivityEvents: 0, outages: 0, insertedOutages: [] }

  const events = await fetchConnectivityEvents(breakerId, from, to)
  if (events.length === 0) {
    return result
  }

  for (const ev of events) {
    const inserted = await db.insert(schema.deviceEvents)
      .values({ deviceId: breakerId, eventType: ev.eventType, eventTime: ev.eventTime })
      .onConflictDoNothing()
      .returning({ id: schema.deviceEvents.id })
    result.connectivityEvents += inserted.length
  }

  // Register series for classification — only needed when we found gaps
  const hasGap = events.some(e => e.eventType === 'offline')
  const registerSeries = hasGap
    ? (await fetchReportLogs(breakerId, 'total_forward_energy', from - 60 * 60 * 1000, to))
        .map(l => ({ ts: l.event_time, kwh: Number(l.value) / 100 }))
        .filter(p => Number.isFinite(p.kwh))
        .sort((a, b) => a.ts - b.ts)
    : []

  for (let i = 0; i < events.length; i++) {
    const ev = events[i]!
    if (ev.eventType !== 'offline') {
      continue
    }
    const restore = events.slice(i + 1).find(e => e.eventType === 'online')
    if (!restore) {
      continue // still offline — the outage closes on a future sweep
    }
    const durationMs = restore.eventTime - ev.eventTime
    if (durationMs < OUTAGE_MIN_DURATION_MS) {
      continue
    }
    const before = registerAround(registerSeries, ev.eventTime, 'before')
    const after = registerAround(registerSeries, restore.eventTime, 'after')
    const delta = before !== null && after !== null ? registerDelta(before, after) : null

    const inserted = await db.insert(schema.outages)
      .values({
        startTs: ev.eventTime,
        endTs: restore.eventTime,
        durationMin: Math.round(durationMs / 6000) / 10,
        kind: classifyOutage(delta),
        registerDeltaKwh: delta
      })
      .onConflictDoNothing()
      .returning({ id: schema.outages.id })
    result.outages += inserted.length
    if (inserted.length > 0) {
      result.insertedOutages.push({
        startTs: ev.eventTime,
        durationMin: Math.round(durationMs / 6000) / 10,
        kind: classifyOutage(delta)
      })
    }
  }

  return result
}
