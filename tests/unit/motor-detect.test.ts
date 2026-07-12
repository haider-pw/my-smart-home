import { describe, expect, it } from 'vitest'
import { isRelayParked } from '../../server/utils/motor-detect'
import { MAX_SESSION_MS } from '../../server/utils/motor-sessions'

const MIN = 60000
const T0 = Date.UTC(2026, 6, 12, 5, 0, 0)

describe('isRelayParked', () => {
  it('parked: newest event is an on older than any plausible run', () => {
    // The interim reality: setup toggles this morning, then left always-on.
    // Real events must NOT win the source selection once the on goes stale,
    // or the signature fallback is starved for the whole query window.
    const events = [
      { eventType: 'on', eventTime: T0 },
      { eventType: 'off', eventTime: T0 + 5 * MIN },
      { eventType: 'on', eventTime: T0 + 10 * MIN }
    ]

    expect(isRelayParked(events, T0 + 10 * MIN + MAX_SESSION_MS + 1)).toBe(true)
  })

  it('not parked: an on within the max-session window is a live run', () => {
    const events = [{ eventType: 'on', eventTime: T0 }]

    expect(isRelayParked(events, T0 + 30 * MIN)).toBe(false)
  })

  it('not parked: newest event is an off — relay is actively switching', () => {
    const events = [
      { eventType: 'on', eventTime: T0 },
      { eventType: 'off', eventTime: T0 + 20 * MIN }
    ]

    expect(isRelayParked(events, T0 + MAX_SESSION_MS * 2)).toBe(false)
  })

  it('not parked when there are no events at all', () => {
    expect(isRelayParked([], T0)).toBe(false)
  })
})
