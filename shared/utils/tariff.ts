/**
 * Pakistan residential electricity billing engine — pure functions, shared
 * between server (reports, alerts) and client (dashboard display).
 *
 * Two cost layers, used together:
 *  1. EFFECTIVE RATE — total payable ÷ units from a real paper bill. Captures
 *     every tax/surcharge implicitly; the most reliable Rs estimate.
 *  2. SLAB MODEL — full tariff structure for *insight*: marginal rate,
 *     units-to-next-slab, slab-jump warnings, TOU comparison.
 *
 * NEPRA slab-benefit rule: since ~2022, unprotected domestic consumers get
 * the benefit of only ONE previous slab (earlier units are billed at the
 * previous slab's rate, not the full progressive ladder). Protected
 * consumers keep the fully progressive calculation. Because DISCOs have
 * varied in applying this, `previousSlabBenefitDepth` is configurable:
 * `1` (default for unprotected) or `Infinity` (fully progressive) — and the
 * whole config is reconciled against the owner's real bill.
 *
 * Default rates: NEPRA FY2025-26 notified schedule (SRO July 2025, in force
 * July 2025 – June 2026; verified against the notified 33.10/37.99/40.22
 * figures and the Rs ~1.15/unit rebasing cut from the FY2024-25 table).
 * STARTING VALUES — editable in settings; the owner's paper bill is the
 * ground truth and the effective-rate layer always wins for cost estimates.
 */

export interface Slab {
  /** Upper bound of the slab in units (kWh); Infinity for the last slab */
  upto: number
  /** PKR per unit */
  rate: number
}

export type ConsumerCategory = 'protected' | 'unprotected'
export type MeterType = 'single-phase' | 'tou'

export interface TariffConfig {
  slabs: Record<ConsumerCategory, Slab[]>
  /** Benefit depth per category: 1 = one previous slab (NEPRA current), Infinity = fully progressive */
  previousSlabBenefitDepth: Record<ConsumerCategory, number>
  tou: {
    peakRate: number
    offPeakRate: number
    /** [startHour, endHour) in PKT, e.g. [18, 22] */
    peakHours: [number, number]
  }
  surcharges: {
    /** Fuel Price Adjustment, PKR per unit */
    fpaPerUnit: number
    /** Quarterly Tariff Adjustment, PKR per unit */
    qtaPerUnit: number
    /** Financing-cost & other per-unit surcharges */
    otherPerUnit: number
    /** Provincial electricity duty, fraction of energy cost (e.g. 0.015) */
    electricityDutyPct: number
    /** GST, fraction (e.g. 0.18) */
    gstPct: number
    /** PTV fee, flat PKR */
    tvFee: number
    /** Meter rent / fixed charges, flat PKR */
    fixedCharges: number
  }
  meterType: MeterType
  category: ConsumerCategory
  /** Day of month the meter is read (billing cycle anchor), 1–28 */
  cycleAnchorDay: number
  /** Rs/unit from the latest real bill (total ÷ units); null until entered */
  effectiveRatePkr: number | null
  /** Monthly budget bands in PKR */
  budget: { green: number, red: number }
}

export const DEFAULT_TARIFF: TariffConfig = {
  slabs: {
    unprotected: [
      { upto: 100, rate: 22.44 },
      { upto: 200, rate: 28.91 },
      { upto: 300, rate: 33.10 },
      { upto: 400, rate: 37.99 },
      { upto: 500, rate: 40.22 },
      { upto: 600, rate: 41.64 },
      { upto: 700, rate: 42.76 },
      { upto: Infinity, rate: 47.69 }
    ],
    protected: [
      { upto: 50, rate: 3.95 },
      { upto: 100, rate: 7.74 },
      { upto: 200, rate: 13.01 },
      // protected status ends above 200 units — fallback only
      { upto: Infinity, rate: 33.10 }
    ]
  },
  previousSlabBenefitDepth: {
    unprotected: 1,
    protected: Number.POSITIVE_INFINITY
  },
  tou: {
    peakRate: 48.84,
    offPeakRate: 32.00,
    peakHours: [18, 22]
  },
  surcharges: {
    fpaPerUnit: 2.50,
    qtaPerUnit: 1.50,
    otherPerUnit: 3.23,
    electricityDutyPct: 0.015,
    gstPct: 0.18,
    tvFee: 35,
    fixedCharges: 0
  },
  meterType: 'single-phase',
  category: 'unprotected',
  cycleAnchorDay: 1,
  effectiveRatePkr: null,
  budget: { green: 20000, red: 30000 }
}

export interface SlabPosition {
  /** Index of the slab the current consumption falls in */
  slabIndex: number
  /** PKR the NEXT unit costs */
  marginalRate: number
  /** Units until the next slab boundary (Infinity in the top slab) */
  unitsToNextSlab: number
}

export interface BillBreakdown extends SlabPosition {
  units: number
  energyCost: number
  fpa: number
  qta: number
  other: number
  electricityDuty: number
  gst: number
  tvFee: number
  fixedCharges: number
  total: number
  /** Blended PKR per unit for this bill */
  effectiveRate: number
}

function slabIndexFor(units: number, slabs: Slab[]): number {
  for (let i = 0; i < slabs.length; i++) {
    if (units <= slabs[i]!.upto) {
      return i
    }
  }
  return slabs.length - 1
}

/**
 * Energy cost under the configurable previous-slab-benefit rule.
 *
 * depth = Infinity → classic progressive: every block at its own rate.
 * depth = d        → only the d slabs immediately below the current one keep
 *                    their own rate; all earlier units are charged at the
 *                    rate of the lowest *benefited* slab.
 */
export function slabEnergyCost(units: number, slabs: Slab[], depth: number): { cost: number } & SlabPosition {
  if (units <= 0) {
    return { cost: 0, slabIndex: 0, marginalRate: slabs[0]?.rate ?? 0, unitsToNextSlab: slabs[0]?.upto ?? Infinity }
  }
  const idx = slabIndexFor(units, slabs)
  const lowestBenefited = Math.max(0, idx - (Number.isFinite(depth) ? depth : idx))

  let cost = 0
  let prevBoundary = 0
  for (let i = 0; i <= idx; i++) {
    const upper = Math.min(units, slabs[i]!.upto)
    const blockUnits = upper - prevBoundary
    if (blockUnits > 0) {
      // Blocks below the benefit window are re-priced at the lowest benefited slab's rate
      const rate = i < lowestBenefited ? slabs[lowestBenefited]!.rate : slabs[i]!.rate
      cost += blockUnits * rate
    }
    prevBoundary = slabs[i]!.upto
    if (units <= prevBoundary) {
      break
    }
  }

  return {
    cost,
    slabIndex: idx,
    marginalRate: slabs[idx]!.rate,
    unitsToNextSlab: Number.isFinite(slabs[idx]!.upto) ? slabs[idx]!.upto - units : Infinity
  }
}

export interface BillInput {
  units: number
  /** Required when meterType = 'tou' */
  peakUnits?: number
  offPeakUnits?: number
  config?: TariffConfig
}

/** Full bill from the slab/TOU model (the insight layer). */
export function computeBill(input: BillInput): BillBreakdown {
  const cfg = input.config ?? DEFAULT_TARIFF
  const units = Math.max(0, input.units)

  let energyCost: number
  let position: SlabPosition
  if (cfg.meterType === 'tou') {
    const peak = Math.max(0, input.peakUnits ?? 0)
    const off = Math.max(0, input.offPeakUnits ?? Math.max(0, units - peak))
    energyCost = peak * cfg.tou.peakRate + off * cfg.tou.offPeakRate
    position = { slabIndex: -1, marginalRate: cfg.tou.peakRate, unitsToNextSlab: Infinity }
  } else {
    const slabs = cfg.slabs[cfg.category]
    const result = slabEnergyCost(units, slabs, cfg.previousSlabBenefitDepth[cfg.category])
    energyCost = result.cost
    position = result
  }

  const s = cfg.surcharges
  const fpa = units * s.fpaPerUnit
  const qta = units * s.qtaPerUnit
  const other = units * s.otherPerUnit
  const electricityDuty = energyCost * s.electricityDutyPct
  const gstBase = energyCost + fpa + qta + other + electricityDuty
  const gst = gstBase * s.gstPct
  const total = gstBase + gst + s.tvFee + s.fixedCharges

  return {
    units,
    energyCost,
    fpa,
    qta,
    other,
    electricityDuty,
    gst,
    tvFee: s.tvFee,
    fixedCharges: s.fixedCharges,
    total,
    effectiveRate: units > 0 ? total / units : 0,
    ...position
  }
}

/**
 * Best-available cost estimate for a number of units:
 * the real-bill effective rate when configured, otherwise the slab model.
 */
export function estimateCostPkr(units: number, cfg: TariffConfig): number {
  if (cfg.effectiveRatePkr && cfg.effectiveRatePkr > 0) {
    return units * cfg.effectiveRatePkr
  }
  return computeBill({ units, config: cfg }).total
}

/** Units affordable for a PKR target under the slab model (binary search). */
export function unitsForBudget(targetPkr: number, cfg: TariffConfig): number {
  if (targetPkr <= 0) {
    return 0
  }
  if (cfg.effectiveRatePkr && cfg.effectiveRatePkr > 0) {
    return targetPkr / cfg.effectiveRatePkr
  }
  let lo = 0
  let hi = 10_000
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2
    if (computeBill({ units: mid, config: cfg }).total < targetPkr) {
      lo = mid
    } else {
      hi = mid
    }
  }
  return (lo + hi) / 2
}

export interface BillingCycle {
  /** UTC epoch ms of cycle start (anchor day, PKT midnight) */
  startTs: number
  /** UTC epoch ms of cycle end (exclusive) */
  endTs: number
  daysElapsed: number
  daysTotal: number
}

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The billing cycle containing `now`: anchorDay → anchorDay (PKT midnights).
 * Anchor is clamped to 1–28 so every month has the day.
 */
export function billingCycleFor(nowTs: number, anchorDay: number): BillingCycle {
  const anchor = Math.min(Math.max(Math.round(anchorDay), 1), 28)
  const pktNow = new Date(nowTs + PKT_OFFSET_MS)
  const year = pktNow.getUTCFullYear()
  const month = pktNow.getUTCMonth()
  const day = pktNow.getUTCDate()

  const startMonth = day >= anchor ? month : month - 1
  const startTs = Date.UTC(year, startMonth, anchor) - PKT_OFFSET_MS
  const endTs = Date.UTC(year, startMonth + 1, anchor) - PKT_OFFSET_MS

  return {
    startTs,
    endTs,
    daysElapsed: Math.floor((nowTs - startTs) / DAY_MS),
    daysTotal: Math.round((endTs - startTs) / DAY_MS)
  }
}

/**
 * JSON-safe (de)serialization — Infinity (top slab bound, progressive benefit
 * depth) does not survive JSON, so it round-trips as null.
 */
export function tariffToStored(cfg: TariffConfig): string {
  return JSON.stringify(cfg, (_key, value) => (value === Infinity ? null : value))
}

export function tariffFromStored(json: string): TariffConfig {
  const parsed = JSON.parse(json) as TariffConfig
  for (const category of ['protected', 'unprotected'] as const) {
    const slabs = parsed.slabs?.[category]
    if (Array.isArray(slabs)) {
      for (const slab of slabs) {
        if (slab.upto === null) {
          slab.upto = Infinity
        }
      }
    }
    if (parsed.previousSlabBenefitDepth && parsed.previousSlabBenefitDepth[category] === null) {
      parsed.previousSlabBenefitDepth[category] = Infinity
    }
  }
  return parsed
}

export interface BillProjection {
  cycle: BillingCycle
  unitsSoFar: number
  projectedUnits: number
  projectedTotalPkr: number
  /** 'green' | 'amber' | 'red' against the configured budget bands */
  budgetStatus: 'green' | 'amber' | 'red'
  /** Daily kWh pace that lands the bill at the green budget ceiling */
  greenPaceKwhPerDay: number
}

/** Projects the cycle bill from consumption so far (linear extrapolation). */
export function projectBill(unitsSoFar: number, nowTs: number, cfg: TariffConfig): BillProjection {
  const cycle = billingCycleFor(nowTs, cfg.cycleAnchorDay)
  const elapsedMs = Math.max(nowTs - cycle.startTs, 1)
  const projectedUnits = unitsSoFar * ((cycle.endTs - cycle.startTs) / elapsedMs)
  const projectedTotalPkr = estimateCostPkr(projectedUnits, cfg)
  const budgetStatus = projectedTotalPkr <= cfg.budget.green
    ? 'green'
    : projectedTotalPkr <= cfg.budget.red ? 'amber' : 'red'

  return {
    cycle,
    unitsSoFar,
    projectedUnits,
    projectedTotalPkr,
    budgetStatus,
    greenPaceKwhPerDay: unitsForBudget(cfg.budget.green, cfg) / cycle.daysTotal
  }
}
