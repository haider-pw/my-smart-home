import { requireSharedSecret } from '../utils/admin-guard'
import * as schema from '../db/schema'
import { useDb } from '../utils/db'
import { addToHourly } from '../utils/poller'
import { pktHourStart } from '../utils/pkt-time'

interface IngestBody {
  energyEvents?: Array<{ deviceId: string, eventTime: number, kwh: number }>
  readings?: Array<{
    deviceId: string
    ts: number
    powerW?: number
    voltageV?: number
    currentA?: number
  }>
  deviceEvents?: Array<{ deviceId: string, eventType: string, eventTime: number }>
}

const VALID_EVENT_TYPES = new Set(['online', 'offline', 'on', 'off'])
const MAX_BATCH = 500

/**
 * POST /api/ingest — idempotent ingestion endpoint for the future homelab
 * Pulsar relay (Phase 8). Same UNIQUE-constraint semantics as the poller:
 * duplicates are silently no-ops, so relay + poller can overlap freely.
 */
export default defineEventHandler(async (event) => {
  requireSharedSecret(event, 'x-ingest-secret')
  const db = useDb()
  const body = await readBody<IngestBody>(event)

  if (!body || typeof body !== 'object') {
    setResponseStatus(event, 400)
    return { success: false as const, data: null, error: 'JSON body required' }
  }

  const result = { energyEvents: 0, readings: 0, deviceEvents: 0 }

  for (const e of (body.energyEvents ?? []).slice(0, MAX_BATCH)) {
    if (typeof e.deviceId !== 'string' || !Number.isFinite(e.eventTime) || !Number.isFinite(e.kwh) || e.kwh < 0) {
      continue
    }
    const inserted = await db.insert(schema.energyEvents)
      .values({ deviceId: e.deviceId, eventTime: e.eventTime, kwh: e.kwh })
      .onConflictDoNothing()
      .returning({ id: schema.energyEvents.id })
    if (inserted.length > 0) {
      await addToHourly(db, e.deviceId, pktHourStart(e.eventTime), e.kwh, 'events')
      result.energyEvents++
    }
  }

  for (const r of (body.readings ?? []).slice(0, MAX_BATCH)) {
    if (typeof r.deviceId !== 'string' || !Number.isFinite(r.ts)) {
      continue
    }
    await db.insert(schema.readings)
      .values({
        deviceId: r.deviceId,
        ts: r.ts,
        powerW: Number.isFinite(r.powerW) ? r.powerW : null,
        voltageV: Number.isFinite(r.voltageV) ? r.voltageV : null,
        currentA: Number.isFinite(r.currentA) ? r.currentA : null,
        source: 'relay'
      })
      .onConflictDoNothing()
    result.readings++
  }

  for (const d of (body.deviceEvents ?? []).slice(0, MAX_BATCH)) {
    if (typeof d.deviceId !== 'string' || !VALID_EVENT_TYPES.has(d.eventType) || !Number.isFinite(d.eventTime)) {
      continue
    }
    await db.insert(schema.deviceEvents)
      .values({ deviceId: d.deviceId, eventType: d.eventType, eventTime: d.eventTime })
      .onConflictDoNothing()
    result.deviceEvents++
  }

  return { success: true as const, data: result, error: null }
})
