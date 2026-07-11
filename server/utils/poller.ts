/**
 * The 5-minute poll cycle: device discovery, readings, energy accounting,
 * connectivity transitions, and outage open/close with power-vs-internet
 * classification. Every write is idempotent (UNIQUE constraints + upserts),
 * so re-runs, retries, and overlapping backfills are all safe.
 */
import { desc, eq, sql } from 'drizzle-orm'
import * as schema from '../db/schema'
import { useDb, type Db } from './db'
import { apportionAcrossHours, classifyOutage, OUTAGE_MIN_DURATION_MS, registerDelta } from './energy-math'
import { pktHourStart } from './pkt-time'
import { listTuyaDevices, type TuyaDevice } from './tuya'
import { addEleToKwh, parseBreakerStatus, parsePlugStatus, roleForCategory } from './tuya-decode'
import { fetchReportLogs } from './tuya-logs'

const ADD_ELE_LOOKBACK_MS = 60 * 60 * 1000 // first-run window; backfill covers older
const ADD_ELE_CURSOR_PREFIX = 'add_ele_cursor:'
const OUTAGE_OPEN_KEY = 'outage_open'
const LAST_POLL_KEY = 'last_poll'
const TUYA_AUTH_ERROR_KEY = 'tuya_auth_error'

export interface PollSummary {
  polledAt: number
  devices: number
  activeDevices: number
  readings: number
  energyEvents: number
  registerKwh: number | null
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

/** Detects online/offline transitions and manages outage windows for the breaker. */
async function handleConnectivity(
  db: Db,
  deviceRow: typeof schema.devices.$inferSelect,
  isOnline: boolean,
  isBreaker: boolean,
  currentRegisterKwh: number | null,
  now: number,
  summary: PollSummary
): Promise<void> {
  const previous = deviceRow.lastOnline

  if (previous !== null && previous !== isOnline) {
    await db.insert(schema.deviceEvents)
      .values({ deviceId: deviceRow.id, eventType: isOnline ? 'online' : 'offline', eventTime: now })
      .onConflictDoNothing()
    summary.transitions.push(`${deviceRow.name}: ${previous ? 'online' : 'offline'} → ${isOnline ? 'online' : 'offline'}`)
  }

  if (isBreaker) {
    const openRaw = await getSyncValue(db, OUTAGE_OPEN_KEY)

    if (!isOnline && previous === true && !openRaw) {
      // Breaker just vanished — open a pending outage with the last register value
      const lastSnapshot = await db.select()
        .from(schema.registerSnapshots)
        .where(eq(schema.registerSnapshots.deviceId, deviceRow.id))
        .orderBy(desc(schema.registerSnapshots.ts))
        .limit(1)
        .get()
      await setSyncValue(db, OUTAGE_OPEN_KEY, JSON.stringify({
        startTs: now,
        registerKwh: lastSnapshot?.registerKwh ?? null
      }))
    }

    if (isOnline && openRaw) {
      const open = JSON.parse(openRaw) as { startTs: number, registerKwh: number | null }
      const durationMs = now - open.startTs
      await deleteSyncValue(db, OUTAGE_OPEN_KEY)

      if (durationMs >= OUTAGE_MIN_DURATION_MS) {
        const delta = open.registerKwh !== null && currentRegisterKwh !== null
          ? registerDelta(open.registerKwh, currentRegisterKwh)
          : null
        await db.insert(schema.outages)
          .values({
            startTs: open.startTs,
            endTs: now,
            durationMin: Math.round(durationMs / 6000) / 10,
            kind: classifyOutage(delta),
            registerDeltaKwh: delta
          })
          .onConflictDoNothing()
        summary.transitions.push(`outage closed: ${classifyOutage(delta)} (${Math.round(durationMs / 60000)} min)`)
      }
    }
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
      let currentRegister: number | null = null
      if (row.role === 'breaker' && device.online) {
        currentRegister = await pollBreaker(db, device, now, summary)
      } else if (row.role === 'plug' && device.online) {
        await pollPlug(db, device, now, summary)
      }
      await handleConnectivity(db, row, device.online, row.role === 'breaker', currentRegister, now, summary)
    } catch (error: unknown) {
      summary.errors.push(`${device.name}: ${error instanceof Error ? error.message : 'poll failed'}`)
    }
  }

  await setSyncValue(db, LAST_POLL_KEY, String(now))
  return summary
}
