import { describe, expect, it } from 'vitest'
import { isIpAllowed, normalizeIp } from '../../server/utils/ip-match'

describe('normalizeIp', () => {
  it('unwraps IPv4-mapped IPv6 addresses', () => {
    expect(normalizeIp('::ffff:39.50.1.2')).toBe('39.50.1.2')
  })

  it('leaves plain addresses untouched', () => {
    expect(normalizeIp('119.155.10.20')).toBe('119.155.10.20')
    expect(normalizeIp('2400:adc1::1')).toBe('2400:adc1::1')
  })
})

describe('isIpAllowed — exact entries', () => {
  it('matches an exact IPv4 entry in a CSV list', () => {
    expect(isIpAllowed('119.155.10.20', '1.2.3.4, 119.155.10.20')).toBe(true)
  })

  it('rejects an IP not in the list', () => {
    expect(isIpAllowed('8.8.8.8', '1.2.3.4, 119.155.10.20')).toBe(false)
  })

  it('matches exact IPv6 entries', () => {
    expect(isIpAllowed('2400:adc1::1', '2400:adc1::1')).toBe(true)
  })
})

describe('isIpAllowed — CIDR entries', () => {
  it('matches inside a /16 (typical PTCL dynamic range)', () => {
    expect(isIpAllowed('39.50.123.45', '39.50.0.0/16')).toBe(true)
  })

  it('rejects outside the /16', () => {
    expect(isIpAllowed('39.51.0.1', '39.50.0.0/16')).toBe(false)
  })

  it('handles /24 boundaries exactly', () => {
    expect(isIpAllowed('10.0.1.255', '10.0.1.0/24')).toBe(true)
    expect(isIpAllowed('10.0.2.0', '10.0.1.0/24')).toBe(false)
  })

  it('/32 behaves like an exact match', () => {
    expect(isIpAllowed('5.5.5.5', '5.5.5.5/32')).toBe(true)
    expect(isIpAllowed('5.5.5.6', '5.5.5.5/32')).toBe(false)
  })

  it('/0 matches everything (explicit opt-in only)', () => {
    expect(isIpAllowed('203.0.113.9', '0.0.0.0/0')).toBe(true)
  })

  it('matches IPv4-mapped IPv6 visitors against IPv4 CIDRs', () => {
    expect(isIpAllowed('::ffff:39.50.9.9', '39.50.0.0/16')).toBe(true)
  })
})

describe('isIpAllowed — hostile/edge input', () => {
  it('empty allowlist matches nothing', () => {
    expect(isIpAllowed('1.2.3.4', '')).toBe(false)
    expect(isIpAllowed('1.2.3.4', '  ')).toBe(false)
  })

  it('missing visitor IP matches nothing', () => {
    expect(isIpAllowed(undefined, '0.0.0.0/0')).toBe(false)
    expect(isIpAllowed(null, '0.0.0.0/0')).toBe(false)
  })

  it('malformed entries are ignored, valid ones still work', () => {
    expect(isIpAllowed('1.2.3.4', 'garbage, 300.1.1.1, 1.2.3.0/33, 1.2.3.4')).toBe(true)
    expect(isIpAllowed('9.9.9.9', 'garbage, 300.1.1.1, 1.2.3.0/33')).toBe(false)
  })

  it('octets above 255 never match', () => {
    expect(isIpAllowed('1.2.3.400', '1.2.3.0/24')).toBe(false)
  })
})
