/**
 * Display formatting helpers — shared by charts and tables.
 * Day keys arrive as PKT 'YYYY-MM-DD' strings from the reports API.
 */

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

function parseDayKey(day: string): { y: number, m: number, d: number } | null {
  const match = day.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) {
    return null
  }
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  if (m < 1 || m > 12 || d < 1 || d > 31) {
    return null
  }
  return { y, m, d }
}

/** '2026-07-05' → '5 Jul' — compact axis labels. */
export function formatDayShort(day: string): string {
  const p = parseDayKey(day)
  if (!p) {
    return day
  }
  return `${p.d} ${MONTHS_SHORT[p.m - 1]}`
}

/** '2026-07-05' → 'Sunday, 5 July 2026' — tooltips and detail views. */
export function formatDayLong(day: string): string {
  const p = parseDayKey(day)
  if (!p) {
    return day
  }
  const weekday = WEEKDAYS[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()]
  return `${weekday}, ${p.d} ${MONTHS_LONG[p.m - 1]} ${p.y}`
}

/** '2026-06' → 'June 2026' — bill months and monthly summaries. */
export function formatMonthLong(month: string): string {
  const match = month.match(/^(\d{4})-(\d{2})$/)
  if (!match) {
    return month
  }
  const m = Number(match[2])
  if (m < 1 || m > 12) {
    return month
  }
  return `${MONTHS_LONG[m - 1]} ${match[1]}`
}

/** 75 → '1h 15m' · 45 → '45m' — runtime durations. */
export function formatMinutes(minutes: number): string {
  const whole = Math.round(minutes)
  if (whole < 60) {
    return `${whole}m`
  }
  const h = Math.floor(whole / 60)
  const m = whole % 60
  return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, '0')}m`
}

/** Epoch ms → 'h:mm am/pm' in PKT (fixed UTC+5). */
export function formatClockPkt(ts: number): string {
  const d = new Date(ts + 5 * 3600 * 1000)
  const h24 = d.getUTCHours()
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h24 < 12 ? 'am' : 'pm'}`
}

/** Consistent series colors for metered devices across every chart/table. */
export const DEVICE_SERIES_COLORS = ['#a98bff', '#34e8a4', '#ffbc57', '#4ad4ff'] as const
export const BASELINE_COLOR = '#6b7a8b'

export function deviceColor(index: number): string {
  return DEVICE_SERIES_COLORS[index % DEVICE_SERIES_COLORS.length]!
}
