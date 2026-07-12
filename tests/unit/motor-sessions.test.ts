import { describe, expect, it } from 'vitest'
import {
  buildSessions,
  estimateKwh,
  MAX_SESSION_MS,
  runtimeByDay
} from '../../server/utils/motor-sessions'
import { pktDayKey, pktDayStart } from '../../shared/utils/pkt-time'

const MIN = 60000
const T0 = Date.UTC(2026, 6, 12, 5, 0, 0) // 10:00 PKT

describe('buildSessions', () => {
  it('pairs on→off transitions into closed sessions', () => {
    const sessions = buildSessions([
      { eventType: 'on', eventTime: T0 },
      { eventType: 'off', eventTime: T0 + 20 * MIN },
      { eventType: 'on', eventTime: T0 + 60 * MIN },
      { eventType: 'off', eventTime: T0 + 85 * MIN }
    ], T0 + 120 * MIN)

    expect(sessions).toHaveLength(2)
    expect(sessions[0]!.minutes).toBeCloseTo(20)
    expect(sessions[1]!.minutes).toBeCloseTo(25)
    expect(sessions.every(s => !s.capped && s.endTs !== null)).toBe(true)
  })

  it('collapses duplicate ons, drops orphan offs, sorts out-of-order events', () => {
    const sessions = buildSessions([
      { eventType: 'off', eventTime: T0 - 5 * MIN }, // orphan — on predates window
      { eventType: 'off', eventTime: T0 + 30 * MIN },
      { eventType: 'on', eventTime: T0 + 10 * MIN }, // duplicate on (retry)
      { eventType: 'on', eventTime: T0 }
    ], T0 + 60 * MIN)

    expect(sessions).toHaveLength(1)
    expect(sessions[0]!.startTs).toBe(T0)
    expect(sessions[0]!.minutes).toBeCloseTo(30)
  })

  it('turns a trailing on into an open session measured to now', () => {
    const sessions = buildSessions([{ eventType: 'on', eventTime: T0 }], T0 + 15 * MIN)

    expect(sessions).toHaveLength(1)
    expect(sessions[0]!.endTs).toBeNull()
    expect(sessions[0]!.minutes).toBeCloseTo(15)
  })

  it('caps a session past 12h as a lost off event', () => {
    const sessions = buildSessions([
      { eventType: 'on', eventTime: T0 },
      { eventType: 'off', eventTime: T0 + MAX_SESSION_MS + 60 * MIN }
    ], T0 + MAX_SESSION_MS + 120 * MIN)

    expect(sessions[0]!.capped).toBe(true)
    expect(sessions[0]!.minutes).toBeCloseTo(MAX_SESSION_MS / MIN)
  })
})

describe('estimateKwh', () => {
  it('converts runtime × rated watts to kWh', () => {
    const sessions = buildSessions([
      { eventType: 'on', eventTime: T0 },
      { eventType: 'off', eventTime: T0 + 40 * MIN }
    ], T0 + 60 * MIN)

    // 40 min at 746 W ≈ 0.497 kWh
    expect(estimateKwh(sessions, 746)).toBeCloseTo(0.497, 2)
  })
})

describe('runtimeByDay', () => {
  it('groups sessions per PKT day and counts fills', () => {
    const days = runtimeByDay(
      buildSessions([
        { eventType: 'on', eventTime: T0 },
        { eventType: 'off', eventTime: T0 + 20 * MIN },
        { eventType: 'on', eventTime: T0 + 24 * 60 * MIN },
        { eventType: 'off', eventTime: T0 + 24 * 60 * MIN + 30 * MIN }
      ], T0 + 26 * 60 * MIN),
      1000, // 1 kW makes the math legible
      T0 + 26 * 60 * MIN,
      pktDayKey,
      pktDayStart
    )

    expect(days).toHaveLength(2)
    expect(days[0]).toMatchObject({ day: '2026-07-12', fills: 1 })
    expect(days[0]!.estKwh).toBeCloseTo(20 / 60, 5)
    expect(days[1]).toMatchObject({ day: '2026-07-13', fills: 1 })
  })

  it('splits a midnight-spanning session across both days', () => {
    // PKT midnight is 19:00 UTC; run 18:50 → 19:10 UTC = 10 min each side
    const start = Date.UTC(2026, 6, 12, 18, 50)
    const days = runtimeByDay(
      buildSessions([
        { eventType: 'on', eventTime: start },
        { eventType: 'off', eventTime: start + 20 * MIN }
      ], start + 60 * MIN),
      1000,
      start + 60 * MIN,
      pktDayKey,
      pktDayStart
    )

    expect(days).toHaveLength(2)
    expect(days[0]!.minutes).toBeCloseTo(10)
    expect(days[1]!.minutes).toBeCloseTo(10)
    // the fill is counted once, on the day it started
    expect(days[0]!.fills).toBe(1)
    expect(days[1]!.fills).toBe(0)
  })
})
