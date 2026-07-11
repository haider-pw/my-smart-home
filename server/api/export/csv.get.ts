import { and, asc, gte, lt } from 'drizzle-orm'
import { pktDayKey, pktHourOfDay } from '../../../shared/utils/pkt-time'
import * as schema from '../../db/schema'
import { useDb } from '../../utils/db'

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_DAYS = 3660

function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}

function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.join(','), ...rows.map(r => r.map(csvEscape).join(','))].join('\n')
}

/**
 * GET /api/export/csv?dataset=hourly|readings|outages&days=30
 * Session-gated by the global middleware; timestamps exported in both
 * epoch ms and PKT-readable form.
 */
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const dataset = ['hourly', 'readings', 'outages'].includes(String(q.dataset)) ? String(q.dataset) : 'hourly'
  const days = Math.min(Math.max(Number(q.days) || 30, 1), MAX_DAYS)
  const db = useDb()
  const now = Date.now()
  const from = now - days * DAY_MS

  const iso = (ts: number) => new Date(ts + 5 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' PKT'

  let csv: string
  if (dataset === 'readings') {
    const rows = await db.select().from(schema.readings)
      .where(and(gte(schema.readings.ts, from), lt(schema.readings.ts, now)))
      .orderBy(asc(schema.readings.ts)).all()
    csv = toCsv(
      ['ts_ms', 'time_pkt', 'device_id', 'power_w', 'voltage_v', 'current_a', 'leakage_ma', 'frequency_hz', 'source'],
      rows.map(r => [r.ts, iso(r.ts), r.deviceId, r.powerW, r.voltageV, r.currentA, r.leakageMa, r.frequencyHz, r.source])
    )
  } else if (dataset === 'outages') {
    const rows = await db.select().from(schema.outages)
      .where(gte(schema.outages.startTs, from))
      .orderBy(asc(schema.outages.startTs)).all()
    csv = toCsv(
      ['start_ms', 'start_pkt', 'end_pkt', 'duration_min', 'kind', 'register_delta_kwh'],
      rows.map(o => [o.startTs, iso(o.startTs), o.endTs ? iso(o.endTs) : '', o.durationMin, o.kind, o.registerDeltaKwh])
    )
  } else {
    const rows = await db.select().from(schema.energyHourly)
      .where(and(gte(schema.energyHourly.hourStart, from), lt(schema.energyHourly.hourStart, now)))
      .orderBy(asc(schema.energyHourly.hourStart)).all()
    csv = toCsv(
      ['hour_start_ms', 'day_pkt', 'hour_pkt', 'device_id', 'kwh', 'source'],
      rows.map(r => [r.hourStart, pktDayKey(r.hourStart), pktHourOfDay(r.hourStart), r.deviceId, Math.round(r.kwh * 10000) / 10000, r.source])
    )
  }

  setHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
  setHeader(event, 'Content-Disposition', `attachment; filename="watt-${dataset}-${days}d.csv"`)
  return csv
})
