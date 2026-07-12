/**
 * Motor run-session derivation — pure functions, no Nuxt dependencies.
 *
 * The water-motor relay (tdq) has no metering chip, so energy is estimated:
 * paired on→off transitions from Tuya's report logs become run sessions, and
 * kWh = runtime × rated watts. A motor pulls a near-constant load while
 * running (unlike a compressor that cycles), so this lands within ~10%.
 */

export interface SwitchEvent {
  /** 'on' | 'off' */
  eventType: string
  /** UTC epoch ms */
  eventTime: number
}

export interface MotorSession {
  startTs: number
  /** null while the motor is still running */
  endTs: number | null
  minutes: number
  /** True when the session hit MAX_SESSION_MS — a lost 'off' event, not a real run */
  capped: boolean
}

/** 1 HP induction motor — the default until the nameplate rating is set. */
export const DEFAULT_MOTOR_WATTS = 746

/**
 * Sessions longer than this are treated as a lost 'off' event and capped, so
 * one missed log can't fabricate days of phantom kWh.
 */
export const MAX_SESSION_MS = 12 * 60 * 60 * 1000

/**
 * Pair on/off transitions into run sessions.
 * - consecutive 'on's collapse into one session (first wins)
 * - an 'off' with no preceding 'on' is dropped (its 'on' predates the window)
 * - a trailing 'on' becomes an open session measured up to `now`
 */
export function buildSessions(events: SwitchEvent[], now: number): MotorSession[] {
  const ordered = [...events].sort((a, b) => a.eventTime - b.eventTime)
  const sessions: MotorSession[] = []
  let openStart: number | null = null

  for (const event of ordered) {
    if (event.eventType === 'on') {
      openStart = openStart ?? event.eventTime
    } else if (event.eventType === 'off' && openStart !== null) {
      sessions.push(closeSession(openStart, event.eventTime))
      openStart = null
    }
  }

  if (openStart !== null && now > openStart) {
    const runMs = now - openStart
    sessions.push({
      startTs: openStart,
      endTs: null,
      minutes: Math.min(runMs, MAX_SESSION_MS) / 60000,
      capped: runMs > MAX_SESSION_MS
    })
  }
  return sessions
}

function closeSession(startTs: number, endTs: number): MotorSession {
  const runMs = Math.max(endTs - startTs, 0)
  return {
    startTs,
    endTs,
    minutes: Math.min(runMs, MAX_SESSION_MS) / 60000,
    capped: runMs > MAX_SESSION_MS
  }
}

/**
 * Estimated energy for a set of sessions at the given rated power.
 * Capped sessions (lost 'off' events — e.g. a relay left always-on) are
 * excluded: fabricating 12 h of phantom motor kWh is worse than under-counting.
 */
export function estimateKwh(sessions: MotorSession[], ratedWatts: number): number {
  const minutes = sessions.filter(s => !s.capped).reduce((a, s) => a + s.minutes, 0)
  return (minutes / 60) * (ratedWatts / 1000)
}

export interface DayRuntime {
  day: string
  fills: number
  minutes: number
  estKwh: number
}

/**
 * Split sessions into per-PKT-day runtime. A session spanning midnight
 * contributes to both days proportionally. Capped sessions are excluded —
 * same phantom-energy guard as estimateKwh.
 */
export function runtimeByDay(
  sessions: MotorSession[],
  ratedWatts: number,
  now: number,
  dayKeyOf: (ts: number) => string,
  dayStartOf: (ts: number) => number
): DayRuntime[] {
  const byDay = new Map<string, { fills: number, minutes: number }>()

  for (const session of sessions.filter(s => !s.capped)) {
    const end = session.endTs ?? Math.min(session.startTs + session.minutes * 60000, now)
    let cursor = session.startTs
    let first = true
    while (cursor < end) {
      const day = dayKeyOf(cursor)
      const nextMidnight = dayStartOf(cursor) + 24 * 60 * 60 * 1000
      const sliceEnd = Math.min(end, nextMidnight)
      const entry = byDay.get(day) ?? { fills: 0, minutes: 0 }
      entry.minutes += (sliceEnd - cursor) / 60000
      if (first) {
        entry.fills += 1
        first = false
      }
      byDay.set(day, entry)
      cursor = sliceEnd
    }
  }

  return Array.from(byDay.entries())
    .map(([day, { fills, minutes }]) => ({
      day,
      fills,
      minutes,
      estKwh: (minutes / 60) * (ratedWatts / 1000)
    }))
    .sort((a, b) => a.day.localeCompare(b.day))
}
