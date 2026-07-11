import { describe, expect, it } from 'vitest'
import {
  billingCycleFor,
  computeBill,
  DEFAULT_TARIFF,
  estimateCostPkr,
  projectBill,
  slabEnergyCost,
  tariffFromStored,
  tariffToStored,
  unitsForBudget,
  type TariffConfig
} from '../../shared/utils/tariff'

const UNPROTECTED = DEFAULT_TARIFF.slabs.unprotected
const PROTECTED = DEFAULT_TARIFF.slabs.protected

describe('slabEnergyCost — fully progressive (depth ∞)', () => {
  it('bills each block at its own rate', () => {
    // Arrange: 350 units → 100@22.44 + 100@28.91 + 100@33.10 + 50@37.99
    const expected = 100 * 22.44 + 100 * 28.91 + 100 * 33.10 + 50 * 37.99

    // Act
    const result = slabEnergyCost(350, UNPROTECTED, Infinity)

    // Assert
    expect(result.cost).toBeCloseTo(expected, 6)
    expect(result.slabIndex).toBe(3)
    expect(result.marginalRate).toBe(37.99)
    expect(result.unitsToNextSlab).toBe(50)
  })

  it('protected category uses progressive by default config', () => {
    // 250 protected units → 50@3.95 + 50@7.74 + 100@13.01 + 50@33.10
    const expected = 50 * 3.95 + 50 * 7.74 + 100 * 13.01 + 50 * 33.10

    const result = slabEnergyCost(250, PROTECTED, DEFAULT_TARIFF.previousSlabBenefitDepth.protected)

    expect(result.cost).toBeCloseTo(expected, 6)
  })
})

describe('slabEnergyCost — one-previous-slab benefit (NEPRA, depth 1)', () => {
  it('reprices earlier blocks at the previous slab rate', () => {
    // 350 units, depth 1: blocks 0–300 at the 201–300 rate, remainder at own
    const expected = 300 * 33.10 + 50 * 37.99

    const result = slabEnergyCost(350, UNPROTECTED, 1)

    expect(result.cost).toBeCloseTo(expected, 6)
  })

  it('captures the brutal slab-jump: 300 → 301 units reprices everything below', () => {
    const at300 = slabEnergyCost(300, UNPROTECTED, 1)
    const at301 = slabEnergyCost(301, UNPROTECTED, 1)

    // 300: 100 repriced @28.91 + 100@28.91 + 100@33.10
    expect(at300.cost).toBeCloseTo(100 * 28.91 + 100 * 28.91 + 100 * 33.10, 6)
    // 301: 300 repriced @33.10 + 1@37.99
    expect(at301.cost).toBeCloseTo(300 * 33.10 + 1 * 37.99, 6)
    // One extra unit costs over Rs 800 — the warning the dashboard exists for
    expect(at301.cost - at300.cost).toBeGreaterThan(800)
  })

  it('first slab has nothing to reprice', () => {
    expect(slabEnergyCost(80, UNPROTECTED, 1).cost).toBeCloseTo(80 * 22.44, 6)
  })

  it('top slab: marginal at max, no next boundary', () => {
    const result = slabEnergyCost(800, UNPROTECTED, 1)

    expect(result.marginalRate).toBe(47.69)
    expect(result.unitsToNextSlab).toBe(Infinity)
    expect(result.slabIndex).toBe(7)
  })

  it('zero and negative units cost nothing', () => {
    expect(slabEnergyCost(0, UNPROTECTED, 1).cost).toBe(0)
    expect(slabEnergyCost(-5, UNPROTECTED, 1).cost).toBe(0)
  })
})

describe('computeBill — surcharge stack', () => {
  it('assembles FPA/QTA/duty/GST/PTV exactly (hand-computed, 100 units)', () => {
    // energy = 100 × 22.44 = 2244
    // fpa 250 · qta 150 · other 323 · duty 2244×.015 = 33.66
    // gstBase 3000.66 · gst 540.1188 · +tvFee 35
    const bill = computeBill({ units: 100 })

    expect(bill.energyCost).toBeCloseTo(2244, 6)
    expect(bill.fpa).toBeCloseTo(250, 6)
    expect(bill.qta).toBeCloseTo(150, 6)
    expect(bill.other).toBeCloseTo(323, 6)
    expect(bill.electricityDuty).toBeCloseTo(33.66, 6)
    expect(bill.gst).toBeCloseTo(540.1188, 4)
    expect(bill.total).toBeCloseTo(3575.7788, 3)
    expect(bill.effectiveRate).toBeCloseTo(35.7578, 3)
  })

  it('TOU meter bypasses slabs: peak/off-peak rates apply', () => {
    const cfg: TariffConfig = { ...DEFAULT_TARIFF, meterType: 'tou' }

    const bill = computeBill({ units: 300, peakUnits: 100, offPeakUnits: 200, config: cfg })

    expect(bill.energyCost).toBeCloseTo(100 * 48.84 + 200 * 32.00, 6)
    expect(bill.slabIndex).toBe(-1)
    expect(bill.marginalRate).toBe(48.84)
  })

  it('TOU infers off-peak from total when not given', () => {
    const cfg: TariffConfig = { ...DEFAULT_TARIFF, meterType: 'tou' }

    const bill = computeBill({ units: 300, peakUnits: 100, config: cfg })

    expect(bill.energyCost).toBeCloseTo(100 * 48.84 + 200 * 32.00, 6)
  })
})

describe('estimateCostPkr — effective-rate layer wins when configured', () => {
  it('uses the real-bill rate when present', () => {
    const cfg: TariffConfig = { ...DEFAULT_TARIFF, effectiveRatePkr: 65 }

    expect(estimateCostPkr(100, cfg)).toBe(6500)
  })

  it('falls back to the slab model when not', () => {
    const cfg: TariffConfig = { ...DEFAULT_TARIFF, effectiveRatePkr: null }

    expect(estimateCostPkr(100, cfg)).toBeCloseTo(computeBill({ units: 100 }).total, 6)
  })
})

describe('unitsForBudget', () => {
  it('inverts the slab model: best units at or under the target bill', () => {
    // The depth-1 slab rule makes the bill DISCONTINUOUS at boundaries
    // (the 301st unit reprices everything below it), so a target inside a
    // jump gap is unreachable — the solver must stop just below the cliff.
    const units = unitsForBudget(20000, DEFAULT_TARIFF)

    expect(computeBill({ units, config: DEFAULT_TARIFF }).total).toBeLessThanOrEqual(20000)
    expect(computeBill({ units: units + 1, config: DEFAULT_TARIFF }).total).toBeGreaterThan(20000)
  })

  it('divides directly under an effective rate', () => {
    const cfg: TariffConfig = { ...DEFAULT_TARIFF, effectiveRatePkr: 50 }

    expect(unitsForBudget(20000, cfg)).toBeCloseTo(400, 6)
  })

  it('zero/negative target → zero units', () => {
    expect(unitsForBudget(0, DEFAULT_TARIFF)).toBe(0)
    expect(unitsForBudget(-100, DEFAULT_TARIFF)).toBe(0)
  })
})

describe('billingCycleFor — meter-reading anchor day', () => {
  it('mid-cycle: 11 July with anchor 14 → cycle is 14 Jun → 14 Jul', () => {
    // 2026-07-11 10:00 PKT = 05:00 UTC
    const now = Date.UTC(2026, 6, 11, 5, 0)

    const cycle = billingCycleFor(now, 14)

    expect(cycle.startTs).toBe(Date.UTC(2026, 5, 14) - 5 * 3600 * 1000)
    expect(cycle.endTs).toBe(Date.UTC(2026, 6, 14) - 5 * 3600 * 1000)
    expect(cycle.daysTotal).toBe(30)
    expect(cycle.daysElapsed).toBe(27)
  })

  it('on the anchor day itself a new cycle starts', () => {
    // 2026-07-14 00:30 PKT
    const now = Date.UTC(2026, 6, 13, 19, 30)

    const cycle = billingCycleFor(now, 14)

    expect(cycle.startTs).toBe(Date.UTC(2026, 6, 14) - 5 * 3600 * 1000)
  })

  it('wraps the year boundary: 5 Jan with anchor 14 → cycle began 14 Dec', () => {
    // 2026-01-05 12:00 PKT
    const now = Date.UTC(2026, 0, 5, 7, 0)

    const cycle = billingCycleFor(now, 14)

    expect(cycle.startTs).toBe(Date.UTC(2025, 11, 14) - 5 * 3600 * 1000)
    expect(cycle.endTs).toBe(Date.UTC(2026, 0, 14) - 5 * 3600 * 1000)
  })

  it('clamps out-of-range anchors into 1–28', () => {
    const now = Date.UTC(2026, 6, 11, 5, 0)

    expect(billingCycleFor(now, 31).startTs).toBe(billingCycleFor(now, 28).startTs)
    expect(billingCycleFor(now, 0).startTs).toBe(billingCycleFor(now, 1).startTs)
  })
})

describe('tariff JSON round-trip', () => {
  it('Infinity survives storage as null and revives on read', () => {
    const json = tariffToStored(DEFAULT_TARIFF)
    const revived = tariffFromStored(json)

    expect(json).not.toContain('Infinity')
    expect(revived.slabs.unprotected.at(-1)!.upto).toBe(Infinity)
    expect(revived.previousSlabBenefitDepth.protected).toBe(Infinity)
    // And the revived config computes identically
    expect(computeBill({ units: 800, config: revived }).total)
      .toBeCloseTo(computeBill({ units: 800, config: DEFAULT_TARIFF }).total, 6)
  })
})

describe('projectBill', () => {
  it('projects linearly and grades against budget bands', () => {
    // Halfway through a 30-day cycle (15 days), 300 units so far → ~600 projected
    const cycleStart = Date.UTC(2026, 5, 14) - 5 * 3600 * 1000
    const now = cycleStart + 15 * 24 * 3600 * 1000
    const cfg: TariffConfig = { ...DEFAULT_TARIFF, cycleAnchorDay: 14, effectiveRatePkr: 60 }

    const projection = projectBill(300, now, cfg)

    expect(projection.projectedUnits).toBeCloseTo(600, 0)
    expect(projection.projectedTotalPkr).toBeCloseTo(36000, -2)
    expect(projection.budgetStatus).toBe('red') // 36k > 30k red line
  })

  it('cheap usage grades green', () => {
    const cycleStart = Date.UTC(2026, 5, 14) - 5 * 3600 * 1000
    const now = cycleStart + 15 * 24 * 3600 * 1000
    const cfg: TariffConfig = { ...DEFAULT_TARIFF, cycleAnchorDay: 14, effectiveRatePkr: 60 }

    const projection = projectBill(100, now, cfg)

    expect(projection.projectedTotalPkr).toBeCloseTo(12000, -2)
    expect(projection.budgetStatus).toBe('green')
    expect(projection.greenPaceKwhPerDay).toBeCloseTo(20000 / 60 / 30, 3)
  })
})
