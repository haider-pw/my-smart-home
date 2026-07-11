import { describe, expect, it } from 'vitest'
import { formatDayLong, formatDayShort, formatMonthLong } from '../../app/utils/format'

describe('formatDayShort', () => {
  it('renders a compact axis label', () => {
    expect(formatDayShort('2026-07-05')).toBe('5 Jul')
    expect(formatDayShort('2026-12-31')).toBe('31 Dec')
  })

  it('passes through unparseable input unchanged', () => {
    expect(formatDayShort('garbage')).toBe('garbage')
    expect(formatDayShort('2026-13-05')).toBe('2026-13-05')
  })
})

describe('formatDayLong', () => {
  it('renders weekday, day, full month, year', () => {
    // 2026-07-05 is a Sunday
    expect(formatDayLong('2026-07-05')).toBe('Sunday, 5 July 2026')
    // 2026-07-11 is a Saturday
    expect(formatDayLong('2026-07-11')).toBe('Saturday, 11 July 2026')
  })

  it('passes through unparseable input unchanged', () => {
    expect(formatDayLong('07-05')).toBe('07-05')
  })
})

describe('formatMonthLong', () => {
  it('renders bill months readably', () => {
    expect(formatMonthLong('2026-06')).toBe('June 2026')
  })

  it('passes through unparseable input', () => {
    expect(formatMonthLong('latest')).toBe('latest')
  })
})
