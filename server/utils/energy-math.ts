/**
 * Energy accounting math — pure functions, no Nuxt dependencies.
 * The correctness-critical piece of the history backend: register deltas,
 * reset handling, and outage classification.
 */

/**
 * kWh consumed between two cumulative-register snapshots.
 *
 * A register that DECREASED means the device's counter was reset/cleared —
 * in that case the new absolute value IS the energy accumulated since the
 * reset (counter restarts at 0), which is the best available estimate.
 * A tiny negative jitter (< 0.005 kWh) is treated as noise → 0.
 */
export function registerDelta(previousKwh: number, currentKwh: number): number {
  const delta = currentKwh - previousKwh
  if (delta >= 0) {
    return delta
  }
  if (delta > -0.005) {
    return 0
  }
  return currentKwh
}

/**
 * Classify an offline gap: if the breaker's register advanced while it was
 * unreachable, the appliances kept drawing power → the mains were fine and
 * only the INTERNET was down. A frozen register means a real POWER outage.
 *
 * `thresholdKwh` absorbs metering noise; with a ~1.8 kW baseline house load,
 * even a 10-minute mains-on gap advances the register by ~0.3 kWh, so 0.02 is
 * a comfortable discriminator for gaps ≥ 5 minutes.
 */
export function classifyOutage(registerDeltaKwh: number | null, thresholdKwh = 0.02): 'power' | 'internet' | 'unknown' {
  if (registerDeltaKwh === null || !Number.isFinite(registerDeltaKwh)) {
    return 'unknown'
  }
  return registerDeltaKwh > thresholdKwh ? 'internet' : 'power'
}

/** Minimum offline duration before we record an outage at all (debounce Wi-Fi blips). */
export const OUTAGE_MIN_DURATION_MS = 4 * 60 * 1000

export interface HourContribution {
  /** UTC epoch ms of the PKT hour start */
  hourStart: number
  kwh: number
}

/**
 * Split an energy amount measured between two instants across the PKT hours
 * it spans, proportionally by time. For 5-min polls this almost always lands
 * in a single hour; at hour boundaries it allocates the sliver correctly, and
 * for long gaps (outage recovery) it spreads the accumulated energy evenly —
 * the honest choice when the true intra-gap profile is unknown.
 */
export function apportionAcrossHours(
  fromTs: number,
  toTs: number,
  kwh: number,
  hourStartOf: (ts: number) => number
): HourContribution[] {
  if (kwh <= 0 || toTs <= fromTs) {
    return []
  }
  const totalMs = toTs - fromTs
  const contributions: HourContribution[] = []
  let cursor = fromTs
  while (cursor < toTs) {
    const hourStart = hourStartOf(cursor)
    const hourEnd = hourStart + 60 * 60 * 1000
    const sliceEnd = Math.min(hourEnd, toTs)
    const share = (sliceEnd - cursor) / totalMs
    contributions.push({ hourStart, kwh: kwh * share })
    cursor = sliceEnd
  }
  return contributions
}
