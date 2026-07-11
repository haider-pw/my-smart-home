/** Client-side dashboard helpers: types mirrored from /api/reports/summary + recommendation logic. */

export const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

export interface SummaryDevice {
  id: string
  name: string
  role: string
  online: boolean | null
  cycleKwh: number
  todayKwh: number
  cycleCostPkr: number
  peakSharePct: number
}

export interface SummaryData {
  generatedAt: number
  tariff: {
    config: {
      meterType: 'single-phase' | 'tou'
      category: 'protected' | 'unprotected'
      effectiveRatePkr: number | null
      budget: { green: number, red: number }
      tou: { peakRate: number, offPeakRate: number, peakHours: [number, number] }
    }
    isDefault: boolean
  }
  cycle: { startTs: number, endTs: number, daysElapsed: number, daysTotal: number }
  units: { cycle: number, today: number, yesterday: number, baseline: number }
  cost: {
    cycleSoFarPkr: number
    projectedPkr: number
    projectedUnits: number
    budgetStatus: 'green' | 'amber' | 'red'
    greenPaceKwhPerDay: number
    todayPkr: number
  }
  slab: {
    current: { index: number, marginalRate: number, unitsToNext: number }
    projected: { index: number, marginalRate: number }
    table: Array<{ upto: number | null, rate: number }>
  }
  devices: SummaryDevice[]
  health: {
    lastPollAt: number | null
    pollStale: boolean
    tuyaAuthError: { at: number, message: string } | null
  }
}

export interface Recommendation {
  rank: number
  head: string
  detail: string
  save: string
  severity: 'high' | 'medium' | 'info'
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-IN')

/**
 * Ranked, actionable savings suggestions from the cycle summary.
 * Deliberately conservative: only claims backed by the numbers on screen.
 */
export function buildRecommendations(s: SummaryData): Recommendation[] {
  const recs: Recommendation[] = []
  const effRate = s.tariff.config.effectiveRatePkr ?? s.cost.cycleSoFarPkr / Math.max(s.units.cycle, 1)
  const isTou = s.tariff.config.meterType === 'tou'

  // 1. Biggest metered consumer
  const plugs = s.devices.filter(d => d.role === 'plug' && d.cycleKwh > 0.5)
  const top = [...plugs].sort((a, b) => b.cycleKwh - a.cycleKwh)[0]
  if (top) {
    const sharePct = Math.round((top.cycleKwh / Math.max(s.units.cycle, 0.001)) * 100)
    recs.push({
      rank: recs.length + 1,
      head: `${top.name} is your biggest metered consumer (${sharePct}% of the house)`,
      detail: isTou
        ? `${Math.round(top.cycleKwh)} kWh this cycle, ${top.peakSharePct}% inside the ${s.tariff.config.tou.peakHours[0]}–${s.tariff.config.tou.peakHours[1] - 12} PM peak. Pre-cool before peak and raise the set-point 1 °C.`
        : `${Math.round(top.cycleKwh)} kWh this cycle. Raising the thermostat 1 °C typically trims compressor energy ~5–8%.`,
      save: `~Rs ${fmt(top.cycleCostPkr * 0.15)}/cycle`,
      severity: 'high'
    })
  }

  // 2. Slab-jump warning
  const toNext = s.slab.current.unitsToNext
  if (!isTou && Number.isFinite(toNext) && toNext < 80 && s.cycle.daysElapsed < s.cycle.daysTotal - 2) {
    const nextRate = s.slab.table[s.slab.current.index + 1]?.rate
    recs.push({
      rank: recs.length + 1,
      head: `Only ${fmt(toNext)} units from the next slab`,
      detail: `Crossing it lifts the marginal rate from Rs ${s.slab.current.marginalRate} to Rs ${nextRate ?? '—'} AND reprices earlier units. Easing off for the rest of the cycle avoids the jump.`,
      save: 'avoid a repriced bill',
      severity: 'medium'
    })
  } else if (!isTou && !Number.isFinite(toNext)) {
    recs.push({
      rank: recs.length + 1,
      head: `You're in the top slab — every unit costs Rs ${s.slab.current.marginalRate}`,
      detail: 'Each unit trimmed now saves at the maximum rate; nothing reprices anymore.',
      save: `Rs ${s.slab.current.marginalRate}/unit`,
      severity: 'medium'
    })
  }

  // 3. Baseline share
  const baselineShare = s.units.baseline / Math.max(s.units.cycle, 0.001)
  if (baselineShare > 0.5 && s.units.cycle > 10) {
    recs.push({
      rank: recs.length + 1,
      head: `${Math.round(baselineShare * 100)}% of usage is unmetered baseline`,
      detail: `Fridge, lights, water pump, and everything not behind a smart plug — Rs ${fmt(s.units.baseline * effRate)} this cycle. A metered plug on the next suspect (water pump?) would break this down.`,
      save: 'visibility first',
      severity: 'info'
    })
  }

  // 4. Today vs yesterday spike
  if (s.units.yesterday > 1 && s.units.today > s.units.yesterday * 1.4) {
    recs.push({
      rank: recs.length + 1,
      head: `Today is running ${Math.round((s.units.today / s.units.yesterday - 1) * 100)}% above yesterday`,
      detail: `${(Math.round(s.units.today * 10) / 10)} kWh so far vs ${(Math.round(s.units.yesterday * 10) / 10)} by this time yesterday — worth a glance at what's on.`,
      save: `~Rs ${fmt((s.units.today - s.units.yesterday) * effRate)}`,
      severity: 'medium'
    })
  }

  return recs.slice(0, 4)
}
