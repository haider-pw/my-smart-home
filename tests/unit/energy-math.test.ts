import { describe, expect, it } from 'vitest'
import {
  apportionAcrossHours,
  classifyOutage,
  registerDelta
} from '../../server/utils/energy-math'
import { pktHourStart } from '../../server/utils/pkt-time'

describe('registerDelta', () => {
  it('returns the plain difference for a normally advancing register', () => {
    expect(registerDelta(2590.6, 2591.05)).toBeCloseTo(0.45, 10)
  })

  it('returns 0 when nothing was consumed', () => {
    expect(registerDelta(2590.6, 2590.6)).toBe(0)
  })

  it('treats tiny negative jitter as zero, not a reset', () => {
    expect(registerDelta(2590.6, 2590.599)).toBe(0)
  })

  it('handles a register reset by counting from zero', () => {
    // Register was 2590.6, device cleared to 0, then accumulated 1.2 kWh
    expect(registerDelta(2590.6, 1.2)).toBe(1.2)
  })
})

describe('classifyOutage', () => {
  it('register advanced during the gap → appliances had power → internet outage', () => {
    expect(classifyOutage(0.31)).toBe('internet')
  })

  it('frozen register → real power outage (load-shedding)', () => {
    expect(classifyOutage(0)).toBe('power')
  })

  it('sub-threshold noise still counts as power outage', () => {
    expect(classifyOutage(0.01)).toBe('power')
  })

  it('missing register evidence → unknown', () => {
    expect(classifyOutage(null)).toBe('unknown')
    expect(classifyOutage(Number.NaN)).toBe('unknown')
  })
})

describe('apportionAcrossHours', () => {
  it('puts a within-hour interval entirely in that hour', () => {
    // 21:10 → 21:15 PKT (16:10 → 16:15 UTC)
    const from = Date.UTC(2026, 6, 11, 16, 10)
    const to = Date.UTC(2026, 6, 11, 16, 15)

    const parts = apportionAcrossHours(from, to, 0.2, pktHourStart)

    expect(parts).toEqual([
      { hourStart: Date.UTC(2026, 6, 11, 16, 0), kwh: 0.2 }
    ])
  })

  it('splits an hour-crossing interval proportionally', () => {
    // 21:50 → 22:10 PKT: 10 min in hour 21, 10 min in hour 22
    const from = Date.UTC(2026, 6, 11, 16, 50)
    const to = Date.UTC(2026, 6, 11, 17, 10)

    const parts = apportionAcrossHours(from, to, 0.4, pktHourStart)

    expect(parts).toHaveLength(2)
    expect(parts[0]).toEqual({ hourStart: Date.UTC(2026, 6, 11, 16, 0), kwh: 0.2 })
    expect(parts[1]).toEqual({ hourStart: Date.UTC(2026, 6, 11, 17, 0), kwh: 0.2 })
  })

  it('spreads a multi-hour gap evenly and conserves total energy', () => {
    // 3-hour outage-recovery gap with 1.5 kWh accumulated
    const from = Date.UTC(2026, 6, 11, 13, 0)
    const to = Date.UTC(2026, 6, 11, 16, 0)

    const parts = apportionAcrossHours(from, to, 1.5, pktHourStart)

    expect(parts).toHaveLength(3)
    const total = parts.reduce((sum, p) => sum + p.kwh, 0)
    expect(total).toBeCloseTo(1.5, 10)
    expect(parts.every(p => Math.abs(p.kwh - 0.5) < 1e-9)).toBe(true)
  })

  it('returns nothing for zero energy or inverted intervals', () => {
    const t = Date.UTC(2026, 6, 11, 16, 0)

    expect(apportionAcrossHours(t, t + 1000, 0, pktHourStart)).toEqual([])
    expect(apportionAcrossHours(t + 1000, t, 1, pktHourStart)).toEqual([])
  })
})
