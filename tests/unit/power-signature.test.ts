import { describe, expect, it } from 'vitest'
import { estimateKwh } from '../../server/utils/motor-sessions'
import { buildBaselineSeries, detectMotorRuns } from '../../server/utils/power-signature'

const MIN = 60000
const T0 = Date.UTC(2026, 6, 12, 5, 0, 0)
const RATED = 750

/** 5-min grid of baseline watts starting at T0. */
function series(watts: number[]) {
  return watts.map((baselineW, i) => ({ ts: T0 + i * 5 * MIN, baselineW }))
}

describe('detectMotorRuns', () => {
  it('detects an up-step then down-step of ~rated watts as one run', () => {
    const runs = detectMotorRuns(series([300, 310, 1060, 1055, 1070, 305, 300]), RATED)

    expect(runs).toHaveLength(1)
    expect(runs[0]!.startTs).toBe(T0 + 10 * MIN)
    expect(runs[0]!.endTs).toBe(T0 + 25 * MIN)
    expect(runs[0]!.minutes).toBeCloseTo(15)
  })

  it('ignores steps outside the motor band (small noise, big AC)', () => {
    // +100 W fridge, then +2000 W appliance — neither is motor-shaped
    const runs = detectMotorRuns(series([300, 400, 380, 2380, 2400, 400, 380]), RATED)

    expect(runs).toHaveLength(0)
  })

  it('drops an up-step that never sees a matching down-step', () => {
    const flat = Array.from({ length: 160 }, (_, i) => (i === 2 ? 1060 : i > 2 ? 1050 : 300))
    const runs = detectMotorRuns(series(flat), RATED)

    // 160 samples × 5 min > 12 h — the candidate expires instead of counting
    expect(runs.filter(r => r.endTs !== null)).toHaveLength(0)
  })

  it('keeps a recent still-open candidate as an ongoing run', () => {
    const runs = detectMotorRuns(series([300, 310, 1060, 1065]), RATED)

    expect(runs).toHaveLength(1)
    expect(runs[0]!.endTs).toBeNull()
    expect(runs[0]!.minutes).toBeCloseTo(5)
  })

  it('feeds estimateKwh like any other session source', () => {
    const runs = detectMotorRuns(series([300, 1060, 1055, 1050, 1045, 300]), RATED)

    // 20 min at 750 W = 0.25 kWh
    expect(estimateKwh(runs, RATED)).toBeCloseTo(0.25, 2)
  })
})

describe('buildBaselineSeries', () => {
  it('subtracts same-poll plug watts from the breaker and floors at 0', () => {
    const breaker = [
      { ts: T0, powerW: 1800 },
      { ts: T0 + 5 * MIN, powerW: 500 },
      { ts: T0 + 10 * MIN, powerW: null } // dropped sample
    ]
    const plugs = [
      { ts: T0, powerW: 1200 },
      { ts: T0, powerW: 400 },
      { ts: T0 + 5 * MIN, powerW: 900 } // plugs briefly exceed breaker
    ]

    const base = buildBaselineSeries(breaker, plugs)

    expect(base).toEqual([
      { ts: T0, baselineW: 200 },
      { ts: T0 + 5 * MIN, baselineW: 0 }
    ])
  })
})
