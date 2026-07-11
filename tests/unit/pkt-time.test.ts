import { describe, expect, it } from 'vitest'
import {
  pktDayKey,
  pktDayOfWeek,
  pktDayStart,
  pktHourOfDay,
  pktHourStart
} from '../../shared/utils/pkt-time'

/** Independent reference: what does the IANA Asia/Karachi zone say? */
function ianaPktParts(ts: number) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false
  })
  const parts = Object.fromEntries(fmt.formatToParts(ts).map(p => [p.type, p.value]))
  return {
    dayKey: `${parts.year}-${parts.month}-${parts.day}`,
    // Intl gives '24' for midnight with hour12:false in some engines — normalize
    hour: Number(parts.hour) % 24
  }
}

describe('pktHourStart', () => {
  it('buckets a mid-hour timestamp to the PKT hour start', () => {
    // Arrange: 2026-07-11 21:37 PKT == 16:37 UTC
    const ts = Date.UTC(2026, 6, 11, 16, 37, 12)

    // Act
    const hourStart = pktHourStart(ts)

    // Assert: PKT hour 21:00 == 16:00 UTC
    expect(hourStart).toBe(Date.UTC(2026, 6, 11, 16, 0, 0))
  })

  it('handles the PKT midnight boundary (19:00 UTC)', () => {
    const justAfterPktMidnight = Date.UTC(2026, 6, 11, 19, 0, 1)

    expect(pktHourStart(justAfterPktMidnight)).toBe(Date.UTC(2026, 6, 11, 19, 0, 0))
  })
})

describe('pktDayStart / pktDayKey', () => {
  it('a UTC evening belongs to the NEXT PKT day', () => {
    // 2026-07-11 20:30 UTC == 2026-07-12 01:30 PKT
    const ts = Date.UTC(2026, 6, 11, 20, 30)

    expect(pktDayKey(ts)).toBe('2026-07-12')
    expect(pktDayStart(ts)).toBe(Date.UTC(2026, 6, 11, 19, 0, 0))
  })

  it('a UTC morning stays in the same PKT day', () => {
    const ts = Date.UTC(2026, 6, 11, 9, 0)

    expect(pktDayKey(ts)).toBe('2026-07-11')
  })

  it('agrees with the IANA Asia/Karachi zone across a year of samples', () => {
    // Cross-check ~365 random-ish instants against Intl — catches any offset bug
    const start = Date.UTC(2025, 7, 1)
    for (let i = 0; i < 365; i++) {
      const ts = start + i * 24 * 60 * 60 * 1000 + (i * 7919) % (24 * 60 * 60 * 1000)
      const iana = ianaPktParts(ts)
      expect(pktDayKey(ts), `day mismatch at ${new Date(ts).toISOString()}`).toBe(iana.dayKey)
      expect(pktHourOfDay(ts), `hour mismatch at ${new Date(ts).toISOString()}`).toBe(iana.hour)
    }
  })
})

describe('pktHourOfDay', () => {
  it('maps the 6–10 PM PKT peak window correctly', () => {
    // 18:00 PKT == 13:00 UTC
    expect(pktHourOfDay(Date.UTC(2026, 6, 11, 13, 0))).toBe(18)
    // 21:59 PKT == 16:59 UTC
    expect(pktHourOfDay(Date.UTC(2026, 6, 11, 16, 59))).toBe(21)
  })
})

describe('pktDayOfWeek', () => {
  it('returns Monday=0 for a known Monday in PKT', () => {
    // 2026-07-06 is a Monday; 10:00 PKT
    expect(pktDayOfWeek(Date.UTC(2026, 6, 6, 5, 0))).toBe(0)
  })

  it('rolls the weekday at PKT midnight, not UTC midnight', () => {
    // 2026-07-11 20:00 UTC is already Sunday 2026-07-12 in PKT
    expect(pktDayOfWeek(Date.UTC(2026, 6, 11, 20, 0))).toBe(6)
  })
})
