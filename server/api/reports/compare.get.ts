import { billingCycleFor, estimateCostPkr } from '../../../shared/utils/tariff'
import * as schema from '../../db/schema'
import { eq } from 'drizzle-orm'
import { useDb } from '../../utils/db'
import { energyByDevice } from '../../utils/reports'
import { getTariffConfig } from '../../utils/tariff-settings'

/**
 * GET /api/reports/compare — this billing cycle vs the previous one,
 * pace-adjusted (compares equal elapsed portions so mid-cycle numbers are fair).
 */
export default defineEventHandler(async () => {
  const db = useDb()
  const now = Date.now()
  const { config } = await getTariffConfig(db)

  const current = billingCycleFor(now, config.cycleAnchorDay)
  const previous = billingCycleFor(current.startTs - 1, config.cycleAnchorDay)
  const elapsedMs = now - current.startTs

  const breaker = await db.select().from(schema.devices).where(eq(schema.devices.role, 'breaker')).get()

  async function totalKwh(from: number, to: number): Promise<number> {
    const rows = await energyByDevice(db, from, to)
    if (breaker) {
      return rows.find(r => r.deviceId === breaker.id)?.kwh ?? 0
    }
    return rows.reduce((a, r) => a + r.kwh, 0)
  }

  const [currentUnits, previousSamePace, previousFull] = await Promise.all([
    totalKwh(current.startTs, now),
    totalKwh(previous.startTs, previous.startTs + elapsedMs),
    totalKwh(previous.startTs, previous.endTs)
  ])

  return {
    success: true as const,
    data: {
      current: {
        cycle: current,
        units: currentUnits,
        costPkr: estimateCostPkr(currentUnits, config)
      },
      previous: {
        cycle: previous,
        unitsSamePace: previousSamePace,
        unitsFull: previousFull,
        costFullPkr: estimateCostPkr(previousFull, config)
      },
      deltaPct: previousSamePace > 0
        ? Math.round(((currentUnits - previousSamePace) / previousSamePace) * 100)
        : null
    },
    error: null
  }
})
