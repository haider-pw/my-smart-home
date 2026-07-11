import { and, asc, eq, gte, isNotNull } from 'drizzle-orm'
import * as schema from '../../db/schema'
import { useDb } from '../../utils/db'

const DAY_MS = 24 * 60 * 60 * 1000
const HEALTHY_MIN_V = 210
const HEALTHY_MAX_V = 250

/**
 * GET /api/reports/voltage?days=7 — electrical-health history from the
 * breaker readings: voltage series + out-of-band events + frequency range.
 */
export default defineEventHandler(async (event) => {
  const days = Math.min(Math.max(Number(getQuery(event).days) || 7, 1), 90)
  const db = useDb()
  const from = Date.now() - days * DAY_MS

  const breaker = await db.select().from(schema.devices).where(eq(schema.devices.role, 'breaker')).get()
  if (!breaker) {
    return { success: true as const, data: { points: [], excursions: [], stats: null }, error: null }
  }

  const rows = await db.select({
    ts: schema.readings.ts,
    voltageV: schema.readings.voltageV,
    frequencyHz: schema.readings.frequencyHz,
    leakageMa: schema.readings.leakageMa
  })
    .from(schema.readings)
    .where(and(
      eq(schema.readings.deviceId, breaker.id),
      gte(schema.readings.ts, from),
      isNotNull(schema.readings.voltageV)
    ))
    .orderBy(asc(schema.readings.ts))
    .all()

  const voltages = rows.map(r => r.voltageV!).filter(v => v > 0)
  const excursions = rows.filter(r => r.voltageV! < HEALTHY_MIN_V || r.voltageV! > HEALTHY_MAX_V)

  return {
    success: true as const,
    data: {
      points: rows.map(r => ({ ts: r.ts, v: r.voltageV, hz: r.frequencyHz, leakMa: r.leakageMa })),
      excursions: excursions.map(r => ({ ts: r.ts, v: r.voltageV })),
      stats: voltages.length > 0
        ? {
            minV: Math.min(...voltages),
            maxV: Math.max(...voltages),
            avgV: Math.round((voltages.reduce((a, b) => a + b, 0) / voltages.length) * 10) / 10,
            samples: voltages.length,
            healthyBand: [HEALTHY_MIN_V, HEALTHY_MAX_V]
          }
        : null
    },
    error: null
  }
})
