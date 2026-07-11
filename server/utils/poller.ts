/**
 * The 5-minute poll cycle: device discovery, readings, energy accounting,
 * connectivity tracking, and a trailing outage sweep. Every write is
 * idempotent (UNIQUE constraints + upserts), so re-runs, retries, and
 * overlapping backfills are all safe.
 */
import { desc, eq, sql } from 'drizzle-orm'
import * as schema from '../db/schema'
import { useDb, type Db } from './db'
import { apportionAcrossHours, registerDelta } from './energy-math'
import { syncBreakerOutages } from './outage-sync'
import { pktHourStart } from '../../shared/utils/pkt-time'
import { listTuyaDevices, type TuyaDevice } from './tuya'
import { addEleToKwh, parseBreakerStatus, parsePlugStatus, roleForCategory } from './tuya-decode'
import { fetchReportLogs } from './tuya-logs'

const ADD_ELE_LOOKBACK_MS = 60 * 60 * 1000 // first-run window; backfill covers older
const ADD_ELE_CURSOR_PREFIX = 'add_ele_cursor:'
const LAST_POLL_KEY = 'last_poll'
const TUYA_AUTH_ERROR_KEY = 'tuya_auth_error'
/** Trailing window each poll re-checks for missed offline/online events. */
const OUTAGE_SWEEP_WINDOW_MS = 12 * 60 * 60 * 1000

export interface PollSummary {
  polledAt: number
  devices: number
  activeDevices: number
  readings: number
  energyEvents: number
  registerKwh: number | null
  outagesSynced: number
  transitions: string[]
  errors: string[]
}

async function getSyncValue(db: Db, key: string): Promise<string | null> {
  const row = await db.select().from(schema.syncState).where(eq(schema.syncState.key, key)).get()
  return row?.value ?? null
}

async function setSyncValue(db: Db, key: string, value: string): Promise<void> {
  await db.insert(schema.syncState)
    .values({ key, value, updatedAt: Date.now() })
    .onConflictDoUpdate({
      target: schema.syncState.key,
      set: { value, updatedAt: Date.now() }
    })
}

async function deleteSyncValue(db: Db, key: string): Promise<void> {
  await db.delete(schema.syncState).where(eq(schema.syncState.key, key))
}

/** Upsert an hourly bucket, adding kWh. `sourceLabel` records the data path. */
export async function addToHourly(
  db: Db,
  deviceId: string,
  hourStart: number,
  kwh: number,
  sourceLabel: string
): Promise<void> {
  if (kwh <= 0) {
    return
  }
  await db.insert(schema.energyHourly)
    .values({ deviceId, hourStart, kwh, source: sourceLabel })
    .onConflictDoUpdate({
      target: [schema.energyHourly.deviceId, schema.energyHourly.hourStart],
      set: { kwh: sql`${schema.energyHourly.kwh} + ${kwh}` }
    })
}

async function upsertDevices(db: Db, tuyaDevices: TuyaDevice[], now: number): Promise<void> {
  for (const d of tuyaDevices) {
    const role = roleForCategory(d.category)
    await db.insert(schema.devices)
      .values({
        id: d.id,
        name: d.name,
        category: d.category,
        productName: d.product_name ?? null,
        role,
        // Monitor breakers and plugs by default; everything else opt-in
        isActive: role !== 'other',
        lastSeenAt: now,
        createdAt: now
      })
      .onConflictDoUpdate({
        target: schema.devices.id,
        set: {
          name: d.name,
          productName: d.product_name ?? null,
          lastSeenAt: now
          // isActive intentionally NOT updated — user's choice survives polls
        }
      })
  }
}

/**
 * Tracks last-known connectivity for status display. Outage detection does
 * NOT live here — it's reconstructed from Tuya's own connectivity logs by
 * syncBreakerOutages (exact timestamps, immune to missed polls).
 */
async function updateConnectivity(
  db: Db,
  deviceRow: typeof schema.devices.$inferSelect,
  isOnline: boolean,
  now: number,
  summary: PollSummary
): Promise<void> {
  if (deviceRow.lastOnline !== null && deviceRow.lastOnline !== isOnline) {
    summary.transitions.push(`${deviceRow.name}: → ${isOnline ? 'online' : 'offline'}`)
  }
  await db.update(schema.devices)
    .set({ lastOnline: isOnline, lastSeenAt: now })
    .where(eq(schema.devices.id, deviceRow.id))
}

async function pollBreaker(
  db: Db,
  device: TuyaDevice,
  now: number,
  summary: PollSummary
): Promise<number | null> {
  const parsed = parseBreakerStatus(device.status ?? [])

  await db.insert(schema.readings)
    .values({
      deviceId: device.id,
      ts: now,
      powerW: parsed.powerW,
      voltageV: parsed.voltageV,
      currentA: parsed.currentA,
      leakageMa: parsed.leakageMa,
      frequencyHz: parsed.frequencyHz,
      source: 'poll'
    })
    .onConflictDoNothing()
  summary.readings++

  if (parsed.registerKwh === null) {
    return null
  }
  summary.registerKwh = parsed.registerKwh

  const previous = await db.select()
    .from(schema.registerSnapshots)
    .where(eq(schema.registerSnapshots.deviceId, device.id))
    .orderBy(desc(schema.registerSnapshots.ts))
    .limit(1)
    .get()

  await db.insert(schema.registerSnapshots)
    .values({ deviceId: device.id, ts: now, registerKwh: parsed.registerKwh })
    .onConflictDoNothing()

  if (previous && now > previous.ts) {
    const delta = registerDelta(previous.registerKwh, parsed.registerKwh)
    for (const part of apportionAcrossHours(previous.ts, now, delta, pktHourStart)) {
      await addToHourly(db, device.id, part.hourStart, part.kwh, 'register')
    }
  }
  return parsed.registerKwh
}

async function pollPlug(
  db: Db,
  device: TuyaDevice,
  now: number,
  summary: PollSummary
): Promise<void> {
  const parsed = parsePlugStatus(device.status ?? [])

  await db.insert(schema.readings)
    .values({
      deviceId: device.id,
      ts: now,
      powerW: parsed.powerW,
      voltageV: parsed.voltageV,
      currentA: parsed.currentA,
      source: 'poll'
    })
    .onConflictDoNothing()
  summary.readings++

  // Exact per-plug energy: pull add_ele report-log events since the cursor
  const cursorKey = ADD_ELE_CURSOR_PREFIX + device.id
  const cursorRaw = await getSyncValue(db, cursorKey)
  const from = cursorRaw ? Number(cursorRaw) : now - ADD_ELE_LOOKBACK_MS

  const logs = await fetchReportLogs(device.id, 'add_ele', from, now)
  let maxEventTime = from

  for (const log of logs) {
    const kwh = addEleToKwh(log.value)
    if (kwh === null || kwh === 0) {
      maxEventTime = Math.max(maxEventTime, log.event_time)
      continue
    }
    const inserted = await db.insert(schema.energyEvents)
      .values({ deviceId: device.id, eventTime: log.event_time, kwh })
      .onConflictDoNothing()
      .returning({ id: schema.energyEvents.id })
    if (inserted.length > 0) {
      // Only count energy the first time we see the event — idempotency
      await addToHourly(db, device.id, pktHourStart(log.event_time), kwh, 'events')
      summary.energyEvents++
    }
    maxEventTime = Math.max(maxEventTime, log.event_time)
  }

  await setSyncValue(db, cursorKey, String(maxEventTime + 1))
}

/** One full poll cycle. Called by the cron task and the admin trigger. */
export async function pollDevices(): Promise<PollSummary> {
  const db = useDb()
  const now = Date.now()
  const summary: PollSummary = {
    polledAt: now,
    devices: 0,
    activeDevices: 0,
    readings: 0,
    energyEvents: 0,
    registerKwh: null,
    outagesSynced: 0,
    transitions: [],
    errors: []
  }

  let tuyaDevices: TuyaDevice[]
  try {
    tuyaDevices = await listTuyaDevices()
    await deleteSyncValue(db, TUYA_AUTH_ERROR_KEY)
  } catch (error: unknown) {
    // Token/permission failures land here — remember them for the UI banner
    const message = error instanceof Error ? error.message : 'Tuya unreachable'
    await setSyncValue(db, TUYA_AUTH_ERROR_KEY, JSON.stringify({ at: now, message }))
    summary.errors.push(message)
    return summary
  }

  summary.devices = tuyaDevices.length
  await upsertDevices(db, tuyaDevices, now)

  const activeRows = await db.select().from(schema.devices).where(eq(schema.devices.isActive, true)).all()
  const rowById = new Map(activeRows.map(r => [r.id, r]))

  for (const device of tuyaDevices) {
    const row = rowById.get(device.id)
    if (!row) {
      continue // inactive (e.g. the neighbour's solar heater)
    }
    summary.activeDevices++

    try {
      if (row.role === 'breaker' && device.online) {
        await pollBreaker(db, device, now, summary)
      } else if (row.role === 'plug' && device.online) {
        await pollPlug(db, device, now, summary)
      }
      await updateConnectivity(db, row, device.online, now, summary)

      if (row.role === 'breaker') {
        // Outage sweep: reconstruct any offline windows Tuya recorded in the
        // trailing 12h — self-healing even when the cron itself was down.
        const sweep = await syncBreakerOutages(db, device.id, now - OUTAGE_SWEEP_WINDOW_MS, now)
        summary.outagesSynced += sweep.outages
      }
    } catch (error: unknown) {
      summary.errors.push(`${device.name}: ${error instanceof Error ? error.message : 'poll failed'}`)
    }
  }

  await setSyncValue(db, LAST_POLL_KEY, String(now))
  return summary
}
