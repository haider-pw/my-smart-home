import { and, asc, eq, gte } from 'drizzle-orm'
import { pktDayStart } from '../../../shared/utils/pkt-time'
import { estimateCostPkr, projectBill, slabEnergyCost } from '../../../shared/utils/tariff'
import * as schema from '../../db/schema'
import { useDb } from '../../utils/db'
import { energyByDevice, peakShareByDevice } from '../../utils/reports'
import { getTariffConfig } from '../../utils/tariff-settings'

/**
 * GET /api/reports/summary — everything the dashboard hero needs in one call:
 * billing-cycle position, projection, per-device breakdown, today/yesterday,
 * slab position, poller health.
 */
export default defineEventHandler(async () => {
  const db = useDb()
  const now = Date.now()
  const { config, isDefault } = await getTariffConfig(db)

  const projection = projectBill(0, now, config) // cycle window first
  const { cycle } = projection
  const todayStart = pktDayStart(now)
  const yesterdayStart = todayStart - 24 * 60 * 60 * 1000

  const [devices, cycleEnergy, todayEnergy, yesterdayToNow, peakShares, lastPollRow, authErrorRow] = await Promise.all([
    db.select().from(schema.devices).where(eq(schema.devices.isActive, true)).all(),
    energyByDevice(db, cycle.startTs, now),
    energyByDevice(db, todayStart, now),
    energyByDevice(db, yesterdayStart, todayStart),
    peakShareByDevice(db, cycle.startTs, now, config.tou.peakHours),
    db.select().from(schema.syncState).where(eq(schema.syncState.key, 'last_poll')).get(),
    db.select().from(schema.syncState).where(eq(schema.syncState.key, 'tuya_auth_error')).get()
  ])

  const breaker = devices.find(d => d.role === 'breaker')
  const cycleByDevice = new Map(cycleEnergy.map(e => [e.deviceId, e.kwh]))
  const todayByDevice = new Map(todayEnergy.map(e => [e.deviceId, e.kwh]))
  const yesterdayByDevice = new Map(yesterdayToNow.map(e => [e.deviceId, e.kwh]))

  // House total = breaker register when present; else sum of everything
  const cycleUnits = breaker
    ? cycleByDevice.get(breaker.id) ?? 0
    : cycleEnergy.reduce((a, e) => a + e.kwh, 0)

  // Projection must extrapolate only over DATA-COVERED time: when history
  // starts mid-cycle (e.g. the app was installed after the reading date),
  // extrapolating over the full elapsed cycle would badly understate the bill.
  const firstDataRow = breaker
    ? await db.select({ hourStart: schema.energyHourly.hourStart })
        .from(schema.energyHourly)
        .where(and(eq(schema.energyHourly.deviceId, breaker.id), gte(schema.energyHourly.hourStart, cycle.startTs)))
        .orderBy(asc(schema.energyHourly.hourStart))
        .limit(1)
        .get()
    : null
  const dataStartTs = Math.max(cycle.startTs, firstDataRow?.hourStart ?? cycle.startTs)
  const coveredMs = Math.max(now - dataStartTs, 1)
  const cycleMs = cycle.endTs - cycle.startTs
  const projectedUnits = cycleUnits * (cycleMs / coveredMs)
  const projectedTotalPkr = estimateCostPkr(projectedUnits, config)
  const paceHelper = projectBill(cycleUnits, now, config) // budget helpers only
  const realProjection = {
    ...paceHelper,
    projectedUnits,
    projectedTotalPkr,
    budgetStatus: (projectedTotalPkr <= config.budget.green
      ? 'green'
      : projectedTotalPkr <= config.budget.red ? 'amber' : 'red') as 'green' | 'amber' | 'red'
  }
  const dataCoverageDays = Math.round(coveredMs / (24 * 60 * 60 * 1000) * 10) / 10

  const slabs = config.slabs[config.category]
  const position = slabEnergyCost(realProjection.projectedUnits, slabs, config.previousSlabBenefitDepth[config.category])
  const currentPosition = slabEnergyCost(cycleUnits, slabs, config.previousSlabBenefitDepth[config.category])

  const deviceRows = devices.map((d) => {
    const share = peakShares.get(d.id)
    const kwh = cycleByDevice.get(d.id) ?? 0
    return {
      id: d.id,
      name: d.name,
      role: d.role,
      online: d.lastOnline,
      cycleKwh: kwh,
      todayKwh: todayByDevice.get(d.id) ?? 0,
      cycleCostPkr: estimateCostPkr(kwh, config),
      peakSharePct: share && share.total > 0 ? Math.round((share.peak / share.total) * 100) : 0
    }
  })

  // Unmetered remainder = breaker − metered plugs
  const pluggedKwh = deviceRows.filter(d => d.role === 'plug').reduce((a, d) => a + d.cycleKwh, 0)
  const baselineKwh = breaker ? Math.max(0, cycleUnits - pluggedKwh) : 0

  return {
    success: true as const,
    data: {
      generatedAt: now,
      tariff: { config, isDefault },
      cycle: { ...realProjection.cycle, dataCoverageDays },
      units: {
        cycle: cycleUnits,
        today: breaker ? todayByDevice.get(breaker.id) ?? 0 : 0,
        yesterday: breaker ? yesterdayByDevice.get(breaker.id) ?? 0 : 0,
        baseline: baselineKwh
      },
      cost: {
        cycleSoFarPkr: estimateCostPkr(cycleUnits, config),
        projectedPkr: realProjection.projectedTotalPkr,
        projectedUnits: realProjection.projectedUnits,
        budgetStatus: realProjection.budgetStatus,
        greenPaceKwhPerDay: realProjection.greenPaceKwhPerDay,
        todayPkr: estimateCostPkr(breaker ? todayByDevice.get(breaker.id) ?? 0 : 0, config)
      },
      slab: {
        current: { index: currentPosition.slabIndex, marginalRate: currentPosition.marginalRate, unitsToNext: currentPosition.unitsToNextSlab },
        projected: { index: position.slabIndex, marginalRate: position.marginalRate },
        table: slabs.map(s => ({ upto: Number.isFinite(s.upto) ? s.upto : null, rate: s.rate }))
      },
      devices: deviceRows,
      health: {
        lastPollAt: lastPollRow ? Number(lastPollRow.value) : null,
        pollStale: lastPollRow ? now - Number(lastPollRow.value) > 15 * 60 * 1000 : true,
        tuyaAuthError: authErrorRow ? JSON.parse(authErrorRow.value) : null
      }
    },
    error: null
  }
})
