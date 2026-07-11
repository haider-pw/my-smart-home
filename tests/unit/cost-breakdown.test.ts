import { describe, expect, it } from 'vitest'
import { buildDailyBreakdown, reconcileDay } from '../../server/utils/cost-breakdown'

describe('reconcileDay', () => {
  it('normal day: baseline = breaker − plugs', () => {
    const result = reconcileDay(20, { a: 3, b: 2 })

    expect(result.totalKwh).toBe(20)
    expect(result.perDevice).toEqual({ a: 3, b: 2, baseline: 15 })
  })

  it('clock-skew day: plugs exceed breaker → proportional clamp, baseline 0, stack sums to breaker', () => {
    // plugs report 5.0 but the breaker's authoritative total is 4.8
    const result = reconcileDay(4.8, { a: 4, b: 1 })

    expect(result.totalKwh).toBe(4.8)
    expect(result.perDevice.baseline).toBe(0)
    expect(result.perDevice.a! + result.perDevice.b!).toBeCloseTo(4.8, 10)
    // proportions preserved: a was 80% of plug load
    expect(result.perDevice.a!).toBeCloseTo(3.84, 10)
  })

  it('no breaker data: plugs are all we know, baseline 0', () => {
    const result = reconcileDay(null, { a: 2.5 })

    expect(result.totalKwh).toBe(2.5)
    expect(result.perDevice).toEqual({ a: 2.5, baseline: 0 })
  })
})

describe('buildDailyBreakdown', () => {
  it('groups rows by day, fills missing plugs with 0, sorts days', () => {
    const rows = [
      { day: '2026-07-11', deviceId: 'brk', kwh: 30 },
      { day: '2026-07-11', deviceId: 'p1', kwh: 4 },
      { day: '2026-07-10', deviceId: 'brk', kwh: 25 },
      { day: '2026-07-10', deviceId: 'p1', kwh: 3 },
      { day: '2026-07-10', deviceId: 'p2', kwh: 2 }
    ]

    const days = buildDailyBreakdown(rows, 'brk', ['p1', 'p2'])

    expect(days.map(d => d.day)).toEqual(['2026-07-10', '2026-07-11'])
    expect(days[0]!.perDevice).toEqual({ p1: 3, p2: 2, baseline: 20 })
    expect(days[1]!.perDevice).toEqual({ p1: 4, p2: 0, baseline: 26 })
  })

  it('ignores devices that are neither breaker nor listed plugs', () => {
    const rows = [
      { day: '2026-07-11', deviceId: 'brk', kwh: 10 },
      { day: '2026-07-11', deviceId: 'ghost', kwh: 99 }
    ]

    const days = buildDailyBreakdown(rows, 'brk', [])

    expect(days[0]!.totalKwh).toBe(10)
  })
})
