import { and, eq } from 'drizzle-orm'
import { pktDayKey, pktDayStart } from '../../../shared/utils/pkt-time'
import { estimateCostPkr } from '../../../shared/utils/tariff'
import * as schema from '../../db/schema'
import { useDb } from '../../utils/db'
import { getMotorSessions } from '../../utils/motor-detect'
import { DEFAULT_MOTOR_WATTS, runtimeByDay } from '../../utils/motor-sessions'
import { getTariffConfig } from '../../utils/tariff-settings'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * GET /api/reports/motor?days=7 — water-motor runtime report derived from
 * switch on/off events: current state, today's fills, per-day runtime, and
 * estimated energy (runtime × rated watts — the relay has no metering chip).
 */
export default defineEventHandler(async (event) => {
  const days = Math.min(Math.max(Number(getQuery(event).days) || 7, 1), 30)
  const db = useDb()
  const now = Date.now()

  const motor = await db.select()
    .from(schema.devices)
    .where(and(eq(schema.devices.role, 'switch'), eq(schema.devices.isActive, true)))
    .get()

  if (!motor) {
    return { success: true as const, data: null, error: null }
  }

  const { config } = await getTariffConfig(db)
  const BLENDED_BASIS_UNITS = 500
  const rate = config.effectiveRatePkr
    ?? estimateCostPkr(BLENDED_BASIS_UNITS, config) / BLENDED_BASIS_UNITS

  const windowStart = pktDayStart(now - (days - 1) * DAY_MS)
  const ratedWatts = motor.ratedWatts ?? DEFAULT_MOTOR_WATTS
  const { sessions, detection } = await getMotorSessions(db, motor.id, windowStart, now)
  const open = sessions.find(s => s.endTs === null) ?? null
  const closed = sessions.filter(s => s.endTs !== null)
  const lastRun = closed[closed.length - 1] ?? null

  const byDay = new Map(
    runtimeByDay(sessions, ratedWatts, now, pktDayKey, pktDayStart).map(d => [d.day, d])
  )
  // Zero-fill so the UI always renders a true N-day axis
  const perDay = Array.from({ length: days }, (_, i) => {
    const day = pktDayKey(windowStart + i * DAY_MS)
    return byDay.get(day) ?? { day, fills: 0, minutes: 0, estKwh: 0 }
  })
  const todayKey = pktDayKey(now)
  const today = perDay.find(d => d.day === todayKey) ?? { day: todayKey, fills: 0, minutes: 0, estKwh: 0 }

  // Window totals come from the day-clipped buckets — the single source of
  // truth — so they can never disagree with the bars
  const windowKwh = perDay.reduce((a, d) => a + d.estKwh, 0)

  return {
    success: true as const,
    data: {
      device: { id: motor.id, name: motor.name, online: motor.lastOnline ?? null },
      detection,
      todayKey,
      ratedWatts,
      isDefaultRating: motor.ratedWatts === null,
      ratePkrPerUnit: Math.round(rate * 100) / 100,
      state: open
        ? { running: true as const, sinceTs: open.startTs, minutes: Math.round(open.minutes) }
        : { running: false as const, sinceTs: lastRun?.endTs ?? null, minutes: 0 },
      today: {
        fills: today.fills,
        minutes: Math.round(today.minutes),
        estKwh: today.estKwh,
        estPkr: today.estKwh * rate
      },
      window: {
        days,
        fills: perDay.reduce((a, d) => a + d.fills, 0),
        minutes: Math.round(perDay.reduce((a, d) => a + d.minutes, 0)),
        estKwh: windowKwh,
        estPkr: windowKwh * rate
      },
      perDay: perDay.map(d => ({
        day: d.day,
        fills: d.fills,
        minutes: Math.round(d.minutes),
        estKwh: d.estKwh,
        estPkr: d.estKwh * rate
      })),
      lastRun: lastRun
        ? { startTs: lastRun.startTs, endTs: lastRun.endTs, minutes: Math.round(lastRun.minutes), capped: lastRun.capped }
        : null
    },
    error: null
  }
})
