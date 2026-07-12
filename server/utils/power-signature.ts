/**
 * Power-signature run detection — pure functions, no Nuxt dependencies.
 *
 * Interim detector for the water motor while its relay carries no metering
 * and stays always-on: the motor's draw appears as a step of ~rated watts in
 * the house baseline (breaker power − metered plug power). We scan the 5-min
 * poll samples for an up-step followed by a matching down-step.
 *
 * Honest limits (surfaced as 'approximate' in the UI): timestamps are
 * quantized to the poll grid (±5 min per edge), runs shorter than a poll gap
 * are invisible, and appliances near motor wattage can confuse it. Replaced
 * by exact sub-meter data once the metering breaker is installed.
 */
import type { MotorSession } from './motor-sessions'
import { MAX_SESSION_MS } from './motor-sessions'

export interface BaselineSample {
  /** UTC epoch ms */
  ts: number
  /** Baseline watts: breaker − sum of metered plugs at the same poll */
  baselineW: number
}

/** Step must be within this band around rated watts to count as the motor. */
export const SIG_STEP_MIN_FACTOR = 0.6
export const SIG_STEP_MAX_FACTOR = 1.5
const STEP_MIN_FACTOR = SIG_STEP_MIN_FACTOR
const STEP_MAX_FACTOR = SIG_STEP_MAX_FACTOR

/**
 * Detect motor-shaped runs in a baseline power series. A run starts at the
 * first sample where the baseline stepped up by ≈ rated watts and ends at
 * the first sample where it stepped back down by a similar magnitude.
 */
export function detectMotorRuns(samples: BaselineSample[], ratedWatts: number): MotorSession[] {
  const ordered = [...samples].sort((a, b) => a.ts - b.ts)
  const minStep = ratedWatts * STEP_MIN_FACTOR
  const maxStep = ratedWatts * STEP_MAX_FACTOR
  const sessions: MotorSession[] = []
  let openStart: number | null = null

  for (let i = 1; i < ordered.length; i++) {
    const delta = ordered[i]!.baselineW - ordered[i - 1]!.baselineW

    if (openStart === null && delta >= minStep && delta <= maxStep) {
      openStart = ordered[i]!.ts
    } else if (openStart !== null && delta <= -minStep && delta >= -maxStep) {
      const runMs = ordered[i]!.ts - openStart
      sessions.push({
        startTs: openStart,
        endTs: ordered[i]!.ts,
        minutes: Math.min(runMs, MAX_SESSION_MS) / 60000,
        capped: runMs > MAX_SESSION_MS
      })
      openStart = null
    } else if (openStart !== null && ordered[i]!.ts - openStart > MAX_SESSION_MS) {
      // No matching down-step within any plausible run — likely a different
      // appliance or a masked off-edge. Drop it rather than fabricate hours.
      openStart = null
    }
  }

  // A still-open candidate at the series end is a possible ongoing run
  if (openStart !== null) {
    const last = ordered[ordered.length - 1]!.ts
    if (last > openStart) {
      sessions.push({
        startTs: openStart,
        endTs: null,
        minutes: (last - openStart) / 60000,
        capped: false
      })
    }
  }
  return sessions
}

/**
 * Join breaker and plug samples (the poller stamps one shared ts per cycle)
 * into a baseline series. Samples without a breaker reading are skipped.
 */
export function buildBaselineSeries(
  breakerSamples: Array<{ ts: number, powerW: number | null }>,
  plugSamples: Array<{ ts: number, powerW: number | null }>
): BaselineSample[] {
  const plugWByTs = new Map<number, number>()
  for (const s of plugSamples) {
    plugWByTs.set(s.ts, (plugWByTs.get(s.ts) ?? 0) + (s.powerW ?? 0))
  }
  return breakerSamples
    .filter(s => s.powerW !== null)
    .map(s => ({ ts: s.ts, baselineW: Math.max(s.powerW! - (plugWByTs.get(s.ts) ?? 0), 0) }))
    .sort((a, b) => a.ts - b.ts)
}
