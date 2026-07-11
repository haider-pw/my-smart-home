/**
 * Best-effort historical backfill from Tuya's ~7-day log retention:
 *  - plugs:   add_ele report-logs → exact energy events
 *  - breaker: total_forward_energy report-logs → register series → hourly deltas
 *  - breaker: online/offline logs → reconstructed, classified outages
 *
 * Every write is idempotent; hours already produced by the live poller are
 * left untouched (live data wins over backfill).
 */
import { eq } from 'drizzle-orm'
import * as schema from '../db/schema'
import { useDb, type Db } from './db'
import { apportionAcrossHours, classifyOutage, OUTAGE_MIN_DURATION_MS, registerDelta } from './energy-math'
import { pktHourStart } from '../../shared/utils/pkt-time'
import { addEleToKwh } from './tuya-decode'
import { fetchConnectivityEvents, fetchReportLogs } from './tuya-logs'

export interface BackfillSummary {
  ranAt: number
  days: number
  plugEvents: number
  breakerHours: number
  outages: number
  errors: string[]
}

async function backfillPlug(db: Db, deviceId: string, from: number, to: number, summary: BackfillSummary): Promise<void> {
  const logs = await fetchReportLogs(deviceId, 'add_ele', from, to)
  for (const log of logs) {
    const kwh = addEleToKwh(log.value)
    if (kwh === null || kwh === 0) {
      continue
    }
    const inserted = await db.insert(schema.energyEvents)
      .values({ deviceId, eventTime: log.event_time, kwh })
      .onConflictDoNothing()
      .returning({ id: schema.energyEvents.id })
    if (inserted.length > 0) {
      await db.insert(schema.energyHourly)
        .values({ deviceId, hourStart: pktHourStart(log.event_time), kwh, source: 'backfill' })
        .onConflictDoUpdate({
          target: [schema.energyHourly.deviceId, schema.energyHourly.hourStart],
          set: { kwh: schema.energyHourly.kwh }
        })
      // Note: on conflict we keep the existing value (no-op update) — an hour
      // already filled by live polling or a previous backfill is never doubled.
      summary.plugEvents++
    }
  }
}

async function backfillBreakerEnergy(db: Db, deviceId: string, from: number, to: number, summary: BackfillSummary): Promise<Map<number, number>> {
  const logs = await fetchReportLogs(deviceId, 'total_forward_energy', from, to)
  const series = logs
    .map(l => ({ ts: l.event_time, kwh: Number(l.value) / 100 }))
    .filter(p => Number.isFinite(p.kwh))
    .sort((a, b) => a.ts - b.ts)

  // Which hours does the live poller already own? Don't touch those.
  const liveHours = new Set(
    (await db.select({ hourStart: schema.energyHourly.hourStart })
      .from(schema.energyHourly)
      .where(eq(schema.energyHourly.deviceId, deviceId))
      .all()).map(r => r.hourStart)
  )

  const hourTotals = new Map<number, number>()
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1]!
    const cur = series[i]!
    const delta = registerDelta(prev.kwh, cur.kwh)
    for (const part of apportionAcrossHours(prev.ts, cur.ts, delta, pktHourStart)) {
      hourTotals.set(part.hourStart, (hourTotals.get(part.hourStart) ?? 0) + part.kwh)
    }
  }

  for (const [hourStart, kwh] of hourTotals) {
    if (liveHours.has(hourStart) || kwh <= 0) {
      continue
    }
    await db.insert(schema.energyHourly)
      .values({ deviceId, hourStart, kwh, source: 'backfill' })
      .onConflictDoNothing()
    summary.breakerHours++
  }

  // Register series doubles as outage-classification evidence
  const registerByTs = new Map(series.map(p => [p.ts, p.kwh]))
  return registerByTs
}

function registerAround(series: Map<number, number>, ts: number, side: 'before' | 'after'): number | null {
  let best: { ts: number, kwh: number } | null = null
  for (const [t, kwh] of series) {
    if (side === 'before' ? t <= ts : t >= ts) {
      if (!best || (side === 'before' ? t > best.ts : t < best.ts)) {
        best = { ts: t, kwh }
      }
    }
  }
  return best?.kwh ?? null
}

async function backfillOutages(
  db: Db,
  breakerId: string,
  registerSeries: Map<number, number>,
  from: number,
  to: number,
  summary: BackfillSummary
): Promise<void> {
  const events = await fetchConnectivityEvents(breakerId, from, to)

  for (const ev of events) {
    await db.insert(schema.deviceEvents)
      .values({ deviceId: breakerId, eventType: ev.eventType, eventTime: ev.eventTime })
      .onConflictDoNothing()
  }

  // Pair offline → next online
  for (let i = 0; i < events.length; i++) {
    const ev = events[i]!
    if (ev.eventType !== 'offline') {
      continue
    }
    const restore = events.slice(i + 1).find(e => e.eventType === 'online')
    if (!restore) {
      continue
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
    if (inserted.length > 0) {
      summary.outages++
    }
  }
}

/** Pulls everything Tuya still remembers (~7 days) into our own history. */
export async function runBackfill(days = 7): Promise<BackfillSummary> {
  const db = useDb()
  const to = Date.now()
  const from = to - days * 24 * 60 * 60 * 1000
  const summary: BackfillSummary = { ranAt: to, days, plugEvents: 0, breakerHours: 0, outages: 0, errors: [] }

  const activeDevices = await db.select().from(schema.devices).where(eq(schema.devices.isActive, true)).all()

  for (const device of activeDevices) {
    try {
      if (device.role === 'plug') {
        await backfillPlug(db, device.id, from, to, summary)
      } else if (device.role === 'breaker') {
        const series = await backfillBreakerEnergy(db, device.id, from, to, summary)
        await backfillOutages(db, device.id, series, from, to, summary)
      }
    } catch (error: unknown) {
      summary.errors.push(`${device.name}: ${error instanceof Error ? error.message : 'backfill failed'}`)
    }
  }
  return summary
}
