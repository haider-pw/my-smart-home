import { describe, expect, it } from 'vitest'
import {
  addEleToKwh,
  decodePhaseA,
  parseBreakerStatus,
  parsePlugStatus,
  roleForCategory
} from '../../server/utils/tuya-decode'

describe('decodePhaseA', () => {
  it('decodes the live sample captured from the real breaker', () => {
    // Arrange: hex 097c001fd6000718 — captured during the Phase 0 DP review
    const captured = 'CXwAH9YABxg='

    // Act
    const reading = decodePhaseA(captured)

    // Assert: 242.8 V · 8.15 A · 1816 W
    expect(reading).toEqual({ voltageV: 242.8, currentA: 8.15, powerW: 1816 })
  })

  it('returns null for malformed base64', () => {
    expect(decodePhaseA('!!!not-base64!!!')).toBeNull()
  })

  it('returns null when the payload is shorter than 8 bytes', () => {
    expect(decodePhaseA(btoa('abc'))).toBeNull()
  })
})

describe('parseBreakerStatus', () => {
  it('parses and scales the full real-world status array', () => {
    const status = [
      { code: 'total_forward_energy', value: 259060 },
      { code: 'phase_a', value: 'CXwAH9YABxg=' },
      { code: 'leakage_current', value: 3 },
      { code: 'supply_frequency', value: 498 },
      { code: 'switch', value: true },
      { code: 'fault', value: 0 }
    ]

    const parsed = parseBreakerStatus(status)

    expect(parsed).toEqual({
      registerKwh: 2590.6,
      voltageV: 242.8,
      currentA: 8.15,
      powerW: 1816,
      leakageMa: 3,
      frequencyHz: 49.8,
      switchOn: true
    })
  })

  it('yields nulls for missing DPs instead of throwing', () => {
    const parsed = parseBreakerStatus([])

    expect(parsed.registerKwh).toBeNull()
    expect(parsed.voltageV).toBeNull()
    expect(parsed.switchOn).toBeNull()
  })
})

describe('parsePlugStatus', () => {
  it('scales cur_power/voltage/current from the real plug DP review values', () => {
    const status = [
      { code: 'switch_1', value: true },
      { code: 'cur_power', value: 12915 },
      { code: 'cur_voltage', value: 2434 },
      { code: 'cur_current', value: 5430 }
    ]

    const parsed = parsePlugStatus(status)

    expect(parsed).toEqual({
      powerW: 1291.5,
      voltageV: 243.4,
      currentA: 5.43,
      switchOn: true
    })
  })
})

describe('addEleToKwh', () => {
  it('converts report-log string values (0.001 kWh units)', () => {
    // Real log sample: value "215" → 0.215 kWh in that 10-min window
    expect(addEleToKwh('215')).toBe(0.215)
  })

  it('accepts numbers and rejects negatives and garbage', () => {
    expect(addEleToKwh(73)).toBe(0.073)
    expect(addEleToKwh(-5)).toBeNull()
    expect(addEleToKwh('abc')).toBeNull()
    expect(addEleToKwh(undefined)).toBeNull()
  })
})

describe('roleForCategory', () => {
  it('maps dlq→breaker, cz→plug, anything else→other', () => {
    expect(roleForCategory('dlq')).toBe('breaker')
    expect(roleForCategory('cz')).toBe('plug')
    expect(roleForCategory('rs')).toBe('other') // the neighbour's solar heater
  })
})
