import { pktDayStart } from '../../shared/utils/pkt-time'
import { estimateCostPkr, unitsForBudget } from '../../shared/utils/tariff'
import { useDb } from '../utils/db'
import { energyByDevice } from '../utils/reports'
import { getTariffConfig } from '../utils/tariff-settings'
import { listTuyaDevices } from '../utils/tuya'
import { parseBreakerStatus, parsePlugStatus, roleForCategory } from '../utils/tuya-decode'

/**
 * GET /api/live — real-time snapshot straight from Tuya (never stored).
 * Called ~every 10s while the Live Monitor tab is visible; costs nothing
 * the rest of the time. Session-gated by the global middleware.
 */
export default defineEventHandler(async () => {
  const db = useDb()
  const now = Date.now()
  const todayStart = pktDayStart(now)

  const [tuyaDevices, { config }, todayEnergy] = await Promise.all([
    listTuyaDevices(),
    getTariffConfig(db),
    energyByDevice(db, todayStart, now)
  ])

  const todayByDevice = new Map(todayEnergy.map(e => [e.deviceId, e.kwh]))
  // Fallback blended rate at a typical monthly volume — a 1-unit bill would
  // overweight the fixed fees and wildly inflate the Rs/hr burn figure.
  const BLENDED_BASIS_UNITS = 500
  const effectiveRate = config.effectiveRatePkr
    ?? estimateCostPkr(BLENDED_BASIS_UNITS, config) / BLENDED_BASIS_UNITS

  interface LiveDevice {
    id: string
    name: string
    role: 'breaker' | 'plug'
    online: boolean
    powerW: number | null
    voltageV: number | null
    currentA: number | null
    powerFactor: number | null
    leakageMa: number | null
    frequencyHz: number | null
    switchOn: boolean | null
    todayKwh: number
    todayCostPkr: number
  }

  const devices: LiveDevice[] = []
  for (const d of tuyaDevices) {
    const role = roleForCategory(d.category)
    if (role === 'other') {
      continue
    }
    const base = {
      id: d.id,
      name: d.name,
      role,
      online: d.online,
      todayKwh: todayByDevice.get(d.id) ?? 0,
      todayCostPkr: (todayByDevice.get(d.id) ?? 0) * effectiveRate
    }
    if (role === 'breaker') {
      const p = parseBreakerStatus(d.status ?? [])
      devices.push({
        ...base,
        powerW: p.powerW,
        voltageV: p.voltageV,
        currentA: p.currentA,
        powerFactor: p.powerW !== null && p.voltageV !== null && p.currentA !== null && p.voltageV * p.currentA > 0
          ? Math.min(Math.round((p.powerW / (p.voltageV * p.currentA)) * 100) / 100, 1)
          : null,
        leakageMa: p.leakageMa,
        frequencyHz: p.frequencyHz,
        switchOn: p.switchOn
      })
    } else {
      const p = parsePlugStatus(d.status ?? [])
      devices.push({
        ...base,
        powerW: p.powerW,
        voltageV: p.voltageV,
        currentA: p.currentA,
        powerFactor: p.powerW !== null && p.voltageV !== null && p.currentA !== null && p.voltageV * p.currentA > 0
          ? Math.min(Math.round((p.powerW / (p.voltageV * p.currentA)) * 100) / 100, 1)
          : null,
        leakageMa: null,
        frequencyHz: null,
        switchOn: p.switchOn
      })
    }
  }

  const breaker = devices.find(d => d.role === 'breaker')
  const totalW = breaker?.powerW ?? devices.reduce((a, d) => a + (d.powerW ?? 0), 0)

  // Average wattage that keeps the month at the green/red budget ceilings
  const greenUnits = unitsForBudget(config.budget.green, config)
  const redUnits = unitsForBudget(config.budget.red, config)
  const hoursPerCycle = 30 * 24

  return {
    success: true as const,
    data: {
      at: now,
      devices,
      totals: {
        powerW: totalW,
        burnPkrPerHour: (totalW / 1000) * effectiveRate,
        voltageV: breaker?.voltageV ?? null,
        currentA: breaker?.currentA ?? null,
        frequencyHz: breaker?.frequencyHz ?? null,
        leakageMa: breaker?.leakageMa ?? null,
        todayKwh: breaker?.todayKwh ?? 0,
        todayCostPkr: breaker?.todayCostPkr ?? 0
      },
      thresholds: {
        greenAvgW: (greenUnits / hoursPerCycle) * 1000,
        redAvgW: (redUnits / hoursPerCycle) * 1000,
        /** Breaker frame rating (amps) — configurable later; default per owner */
        breakerRatedA: 63
      },
      effectiveRatePkr: effectiveRate
    },
    error: null
  }
})
