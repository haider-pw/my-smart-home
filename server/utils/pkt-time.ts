/**
 * Pakistan-time bucketing — pure functions, no Nuxt dependencies.
 *
 * Storage is always UTC epoch milliseconds; every user-facing boundary
 * ("today", hourly buckets, billing-cycle days) is computed in Asia/Karachi.
 * Pakistan abolished DST, so PKT is a fixed UTC+5 — but we keep the offset in
 * one named constant and cross-check against the IANA zone in unit tests.
 */

export const PKT_OFFSET_MS = 5 * 60 * 60 * 1000
export const HOUR_MS = 60 * 60 * 1000
export const DAY_MS = 24 * HOUR_MS

/** UTC epoch ms of the start of the PKT hour containing `ts`. */
export function pktHourStart(ts: number): number {
  return Math.floor((ts + PKT_OFFSET_MS) / HOUR_MS) * HOUR_MS - PKT_OFFSET_MS
}

/** UTC epoch ms of PKT midnight for the day containing `ts`. */
export function pktDayStart(ts: number): number {
  return Math.floor((ts + PKT_OFFSET_MS) / DAY_MS) * DAY_MS - PKT_OFFSET_MS
}

/** Hour of day (0–23) in PKT — feeds the usage heatmap and peak-window logic. */
export function pktHourOfDay(ts: number): number {
  return Math.floor(((ts + PKT_OFFSET_MS) % DAY_MS) / HOUR_MS)
}

/** PKT calendar day as 'YYYY-MM-DD'. */
export function pktDayKey(ts: number): string {
  const shifted = new Date(ts + PKT_OFFSET_MS)
  const y = shifted.getUTCFullYear()
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const d = String(shifted.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** PKT day-of-week, 0 = Monday … 6 = Sunday. */
export function pktDayOfWeek(ts: number): number {
  const jsDow = new Date(ts + PKT_OFFSET_MS).getUTCDay() // 0 = Sunday
  return (jsDow + 6) % 7
}
