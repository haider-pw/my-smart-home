/**
 * Per-device daily cost breakdown — pure functions, no Nuxt dependencies.
 *
 * Attribution model: device kWh × the blended effective rate. Under slab
 * pricing "which device caused the expensive slab" is not truly attributable,
 * so flat-rate attribution is the honest standard (matches the device table).
 *
 * Reconciliation: plug add_ele events and breaker register deltas land on
 * slightly different clocks, so on rare days the plugs can nominally exceed
 * the breaker. Each day's stack must still sum to the breaker's true kWh —
 * plugs are proportionally clamped and baseline floors at 0.
 */
import type { DailyDeviceRow } from './reports'

export interface DayBreakdown {
  day: string
  /** House total for the day (breaker when present, else sum of plugs) */
  totalKwh: number
  /** deviceId → kWh, plus 'baseline' pseudo-device; sums to totalKwh */
  perDevice: Record<string, number>
}

/**
 * Reconcile one day: clamp plugs proportionally when they exceed the breaker
 * total; baseline = remainder, floored at 0.
 */
export function reconcileDay(
  breakerKwh: number | null,
  plugKwh: Record<string, number>
): { totalKwh: number, perDevice: Record<string, number> } {
  const plugSum = Object.values(plugKwh).reduce((a, b) => a + b, 0)

  if (breakerKwh === null) {
    // No breaker data that day — plugs are all we know
    return { totalKwh: plugSum, perDevice: { ...plugKwh, baseline: 0 } }
  }

  if (plugSum <= breakerKwh) {
    return {
      totalKwh: breakerKwh,
      perDevice: { ...plugKwh, baseline: breakerKwh - plugSum }
    }
  }

  // Clock-skew day: plugs nominally exceed the breaker — scale them down so
  // the stack still sums to the breaker's authoritative total.
  const scale = plugSum > 0 ? breakerKwh / plugSum : 0
  const scaled: Record<string, number> = {}
  for (const [id, kwh] of Object.entries(plugKwh)) {
    scaled[id] = kwh * scale
  }
  return { totalKwh: breakerKwh, perDevice: { ...scaled, baseline: 0 } }
}

/** Group raw daily-device rows into reconciled per-day breakdowns. */
export function buildDailyBreakdown(
  rows: DailyDeviceRow[],
  breakerId: string | null,
  plugIds: string[]
): DayBreakdown[] {
  const days = new Map<string, { breaker: number | null, plugs: Record<string, number> }>()
  const plugSet = new Set(plugIds)

  for (const row of rows) {
    let entry = days.get(row.day)
    if (!entry) {
      entry = { breaker: null, plugs: {} }
      days.set(row.day, entry)
    }
    if (row.deviceId === breakerId) {
      entry.breaker = (entry.breaker ?? 0) + row.kwh
    } else if (plugSet.has(row.deviceId)) {
      entry.plugs[row.deviceId] = (entry.plugs[row.deviceId] ?? 0) + row.kwh
    }
  }

  return Array.from(days.entries())
    .map(([day, { breaker, plugs }]) => {
      const full: Record<string, number> = {}
      for (const id of plugIds) {
        full[id] = plugs[id] ?? 0
      }
      const reconciled = reconcileDay(breaker, full)
      return { day, totalKwh: reconciled.totalKwh, perDevice: reconciled.perDevice }
    })
    .sort((a, b) => a.day.localeCompare(b.day))
}
