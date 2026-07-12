import { eq } from 'drizzle-orm'
import { pktDayKey, pktDayStart } from '../../../shared/utils/pkt-time'
import { billingCycleFor, estimateCostPkr } from '../../../shared/utils/tariff'
import * as schema from '../../db/schema'
import { buildDailyBreakdown, carveEstimatedDevice } from '../../utils/cost-breakdown'
import { useDb } from '../../utils/db'
import { getMotorSessions } from '../../utils/motor-detect'
import { DEFAULT_MOTOR_WATTS, runtimeByDay } from '../../utils/motor-sessions'
import { dailyByDevice } from '../../utils/reports'
import { getTariffConfig } from '../../utils/tariff-settings'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * GET /api/reports/cost?range=cycle|7|14|30 — the per-device cost breakdown:
 * reconciled daily stacks, per-device summaries with coverage-aware cycle
 * projections, and a cumulative spend series (cycle mode).
 *
 * Attribution: kWh × blended effective rate (see cost-breakdown.ts docs).
 */
export default defineEventHandler(async (event) => {
  const rangeParam = String(getQuery(event).range ?? 'cycle')
  const db = useDb()
  const now = Date.now()
  const { config } = await getTariffConfig(db)
  const rate = config.effectiveRatePkr && config.effectiveRatePkr > 0
    ? config.effectiveRatePkr
    : estimateCostPkr(500, config) / 500 // blended fallback at typical volume

  const cycle = billingCycleFor(now, config.cycleAnchorDay)
  const isCycle = rangeParam === 'cycle'
  const days = isCycle ? 0 : Math.min(Math.max(Number(rangeParam) || 7, 1), 90)
  const from = isCycle ? cycle.startTs : pktDayStart(now - (days - 1) * DAY_MS)
  const to = now

  const [devices, rows] = await Promise.all([
    db.select().from(schema.devices).where(eq(schema.devices.isActive, true)).all(),
    dailyByDevice(db, from, to)
  ])

  const breaker = devices.find(d => d.role === 'breaker') ?? null
  const plugs = devices.filter(d => d.role === 'plug')
  let breakdown = buildDailyBreakdown(rows, breaker?.id ?? null, plugs.map(p => p.id))

  // Water motor: no metering chip — carve estimated kWh (runtime x rated
  // watts from switch on/off events) out of the unmetered baseline.
  const motor = devices.find(d => d.role === 'switch') ?? null
  if (motor) {
    const { sessions } = await getMotorSessions(db, motor.id, from, now)
    const perDay = runtimeByDay(
      sessions,
      motor.ratedWatts ?? DEFAULT_MOTOR_WATTS,
      now,
      pktDayKey,
      pktDayStart
    )
    breakdown = carveEstimatedDevice(
      breakdown,
      new Map(perDay.map(d => [d.day, d.estKwh])),
      motor.id
    )
  }

  const todayKey = pktDayKey(now)
  const completeDays = breakdown.filter(d => d.day !== todayKey)

  // Coverage-aware projection window (same principle as the summary fix):
  // extrapolate over the time our data actually covers, not the full cycle.
  const firstDay = breakdown[0]?.day
  const dataStartTs = firstDay
    ? Math.max(from, Date.UTC(
        Number(firstDay.slice(0, 4)), Number(firstDay.slice(5, 7)) - 1, Number(firstDay.slice(8, 10))
      ) - 5 * 3600 * 1000)
    : from
  const coveredMs = Math.max(now - dataStartTs, 1)
  const cycleMs = cycle.endTs - cycle.startTs

  interface DeviceSummary {
    id: string
    name: string
    role: 'plug' | 'baseline' | 'motor'
    /** True when kWh is estimated (runtime x rated watts), not metered */
    estimated: boolean
    kwh: number
    costPkr: number
    todayKwh: number
    todayCostPkr: number
    avgPerDayKwh: number
    sharePct: number
    projectedCycleKwh: number | null
    projectedCyclePkr: number | null
  }

  const totalKwh = breakdown.reduce((a, d) => a + d.totalKwh, 0)
  const today = breakdown.find(d => d.day === todayKey)

  function summarize(id: string, name: string, role: 'plug' | 'baseline' | 'motor'): DeviceSummary {
    const kwh = breakdown.reduce((a, d) => a + (d.perDevice[id] ?? 0), 0)
    const todayKwh = today?.perDevice[id] ?? 0
    const completeKwh = completeDays.reduce((a, d) => a + (d.perDevice[id] ?? 0), 0)
    const projected = isCycle ? kwh * (cycleMs / coveredMs) : null
    return {
      id,
      name,
      role,
      estimated: role === 'motor',
      kwh,
      costPkr: kwh * rate,
      todayKwh,
      todayCostPkr: todayKwh * rate,
      avgPerDayKwh: completeDays.length > 0 ? completeKwh / completeDays.length : 0,
      sharePct: totalKwh > 0 ? Math.round((kwh / totalKwh) * 100) : 0,
      projectedCycleKwh: projected,
      projectedCyclePkr: projected !== null ? projected * rate : null
    }
  }

  const summaries: DeviceSummary[] = [
    ...plugs.map(p => summarize(p.id, p.name, 'plug')),
    ...(motor ? [summarize(motor.id, motor.name, 'motor')] : []),
    summarize('baseline', 'Baseline (unmetered)', 'baseline')
  ].sort((a, b) => b.kwh - a.kwh)

  // Cumulative spend (cycle mode): running Rs total per day
  let running = 0
  const cumulative = isCycle
    ? breakdown.map((d) => {
        running += d.totalKwh * rate
        return { day: d.day, cumPkr: Math.round(running) }
      })
    : []

  return {
    success: true as const,
    data: {
      range: isCycle ? 'cycle' : String(days),
      ratePkrPerUnit: Math.round(rate * 100) / 100,
      rateSource: config.effectiveRatePkr ? 'bill' : 'slab-model',
      cycle: { ...cycle, todayKey },
      totals: { kwh: totalKwh, costPkr: totalKwh * rate },
      days: breakdown.map(d => ({
        day: d.day,
        partial: d.day === todayKey,
        totalKwh: d.totalKwh,
        totalPkr: d.totalKwh * rate,
        perDevicePkr: Object.fromEntries(Object.entries(d.perDevice).map(([id, kwh]) => [id, kwh * rate]))
      })),
      devices: summaries,
      cumulative,
      budget: config.budget
    },
    error: null
  }
})
