/**
 * Tuya DP decoding and scaling — pure functions, no Nuxt dependencies.
 *
 * Scales confirmed against the real devices' specifications during the
 * Phase 0 DP review (see /explorer):
 *   breaker (dlq): total_forward_energy ×0.01 kWh · phase_a raw-packed V/A/W
 *                  supply_frequency ×0.1 Hz · leakage_current mA
 *   plugs (cz):    add_ele ×0.001 kWh · cur_power ×0.1 W · cur_voltage ×0.1 V
 *                  cur_current mA
 */

export interface PhaseAReading {
  voltageV: number
  currentA: number
  powerW: number
}

/**
 * Breaker `phase_a` DP: base64 of 8 bytes —
 * [0..1] voltage ×0.1 V · [2..4] current in mA · [5..7] power in W (big-endian).
 * Verified against live data: 097c001fd6000718 → 242.8 V, 8.15 A, 1816 W.
 */
export function decodePhaseA(base64Value: string): PhaseAReading | null {
  let raw: Uint8Array
  try {
    const bin = atob(base64Value)
    raw = Uint8Array.from(bin, c => c.charCodeAt(0))
  } catch {
    return null
  }
  if (raw.length < 8) {
    return null
  }
  const voltageV = ((raw[0]! << 8) | raw[1]!) / 10
  const currentA = ((raw[2]! << 16) | (raw[3]! << 8) | raw[4]!) / 1000
  const powerW = (raw[5]! << 16) | (raw[6]! << 8) | raw[7]!
  return { voltageV, currentA, powerW }
}

export interface StatusItem {
  code: string
  value: unknown
}

export interface BreakerStatus {
  registerKwh: number | null
  voltageV: number | null
  currentA: number | null
  powerW: number | null
  leakageMa: number | null
  frequencyHz: number | null
  switchOn: boolean | null
}

export interface PlugStatus {
  powerW: number | null
  voltageV: number | null
  currentA: number | null
  switchOn: boolean | null
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function parseBreakerStatus(status: StatusItem[]): BreakerStatus {
  const byCode = new Map(status.map(s => [s.code, s.value]))
  const phaseA = typeof byCode.get('phase_a') === 'string'
    ? decodePhaseA(byCode.get('phase_a') as string)
    : null
  const register = num(byCode.get('total_forward_energy'))
  const leakage = num(byCode.get('leakage_current'))
  const frequency = num(byCode.get('supply_frequency'))
  const sw = byCode.get('switch')

  return {
    registerKwh: register === null ? null : register / 100,
    voltageV: phaseA?.voltageV ?? null,
    currentA: phaseA?.currentA ?? null,
    powerW: phaseA?.powerW ?? null,
    leakageMa: leakage,
    frequencyHz: frequency === null ? null : frequency / 10,
    switchOn: typeof sw === 'boolean' ? sw : null
  }
}

export function parsePlugStatus(status: StatusItem[]): PlugStatus {
  const byCode = new Map(status.map(s => [s.code, s.value]))
  const power = num(byCode.get('cur_power'))
  const voltage = num(byCode.get('cur_voltage'))
  const current = num(byCode.get('cur_current'))
  const sw = byCode.get('switch_1')

  return {
    powerW: power === null ? null : power / 10,
    voltageV: voltage === null ? null : voltage / 10,
    currentA: current === null ? null : current / 1000,
    switchOn: typeof sw === 'boolean' ? sw : null
  }
}

/** Plug add_ele log value (string or number) → kWh. */
export function addEleToKwh(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN
  if (!Number.isFinite(n) || n < 0) {
    return null
  }
  return n / 1000
}

/** Which app role a Tuya category maps to; anything else is not monitored. */
export function roleForCategory(category: string): 'breaker' | 'plug' | 'switch' | 'other' {
  if (category === 'dlq') {
    return 'breaker'
  }
  if (category === 'cz') {
    return 'plug'
  }
  if (category === 'tdq') {
    // Non-metering relay (e.g. the water-motor 30A switch): only on/off
    // state — energy is estimated from runtime × rated watts.
    return 'switch'
  }
  return 'other'
}

export interface SwitchStatus {
  switchOn: boolean | null
  /** Raw fault bitmap DP — 0 means healthy */
  fault: number | null
}

export function parseSwitchStatus(status: StatusItem[]): SwitchStatus {
  const byCode = new Map(status.map(s => [s.code, s.value]))
  const sw = byCode.get('switch_1')
  return {
    switchOn: typeof sw === 'boolean' ? sw : null,
    fault: num(byCode.get('fault'))
  }
}

/** switch_1 report-log value → on/off (Tuya logs booleans as 'true'/'false'). */
export function switchLogToState(value: unknown): 'on' | 'off' | null {
  if (value === true || value === 'true') {
    return 'on'
  }
  if (value === false || value === 'false') {
    return 'off'
  }
  return null
}
