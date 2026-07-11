import { createHash, createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  buildPathWithQuery,
  buildStringToSign,
  hmacSha256HexUpper,
  sha256Hex,
  signTuyaRequest
} from '../../server/utils/tuya-sign'

describe('sha256Hex', () => {
  it('hashes the empty string to the well-known SHA-256 digest', async () => {
    // Arrange — Tuya signs empty bodies as SHA256('')
    const wellKnownEmptyHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

    // Act
    const digest = await sha256Hex('')

    // Assert
    expect(digest).toBe(wellKnownEmptyHash)
  })

  it('matches node:crypto output for an arbitrary payload', async () => {
    const payload = '{"device":"breaker","value":42}'
    const expected = createHash('sha256').update(payload, 'utf8').digest('hex')

    const digest = await sha256Hex(payload)

    expect(digest).toBe(expected)
  })
})

describe('hmacSha256HexUpper', () => {
  it('matches an independent node:crypto implementation, uppercased', async () => {
    const key = 'test-secret-key'
    const message = 'client123' + '1700000000000' + 'nonce-1' + 'GET\nabc\n\n/v1.0/token'
    const expected = createHmac('sha256', key).update(message, 'utf8').digest('hex').toUpperCase()

    const signature = await hmacSha256HexUpper(key, message)

    expect(signature).toBe(expected)
    expect(signature).toMatch(/^[0-9A-F]{64}$/)
  })
})

describe('buildPathWithQuery', () => {
  it('returns the bare path when there is no query', () => {
    expect(buildPathWithQuery('/v1.0/token')).toBe('/v1.0/token')
  })

  it('sorts query keys alphabetically as Tuya requires', () => {
    const path = buildPathWithQuery('/v1.0/devices', {
      size: 100,
      category: 'dlq',
      active: true
    })

    expect(path).toBe('/v1.0/devices?active=true&category=dlq&size=100')
  })

  it('drops undefined values and URL-encodes the rest', () => {
    const path = buildPathWithQuery('/v1.0/devices', {
      name: 'AC one',
      skip: undefined
    })

    expect(path).toBe('/v1.0/devices?name=AC%20one')
  })

  it('keeps commas raw in list values — Tuya signs them unencoded', () => {
    const path = buildPathWithQuery('/v1.0/devices/x/logs', { type: '1,2', size: 100 })

    expect(path).toBe('/v1.0/devices/x/logs?size=100&type=1,2')
  })
})

describe('buildStringToSign', () => {
  it('assembles METHOD, content hash, blank header section, and sorted URL', async () => {
    const emptyHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

    const stringToSign = await buildStringToSign('get', '/v1.0/token', { grant_type: 1 })

    expect(stringToSign).toBe(`GET\n${emptyHash}\n\n/v1.0/token?grant_type=1`)
  })

  it('hashes the body when one is provided', async () => {
    const body = '{"commands":[]}'
    const bodyHash = createHash('sha256').update(body, 'utf8').digest('hex')

    const stringToSign = await buildStringToSign('POST', '/v1.0/devices/x/commands', undefined, body)

    expect(stringToSign).toBe(`POST\n${bodyHash}\n\n/v1.0/devices/x/commands`)
  })
})

describe('signTuyaRequest', () => {
  it('signs token requests as clientId + t + nonce + stringToSign', async () => {
    const input = {
      clientId: 'client-abc',
      clientSecret: 'secret-xyz',
      t: '1700000000000',
      nonce: 'nonce-123',
      stringToSign: 'GET\nhash\n\n/v1.0/token?grant_type=1'
    }
    const expected = createHmac('sha256', input.clientSecret)
      .update(input.clientId + input.t + input.nonce + input.stringToSign, 'utf8')
      .digest('hex')
      .toUpperCase()

    const signature = await signTuyaRequest(input)

    expect(signature).toBe(expected)
  })

  it('inserts the access token between clientId and t on business calls', async () => {
    const input = {
      clientId: 'client-abc',
      clientSecret: 'secret-xyz',
      t: '1700000000000',
      nonce: 'nonce-123',
      accessToken: 'token-777',
      stringToSign: 'GET\nhash\n\n/v1.0/devices'
    }
    const expected = createHmac('sha256', input.clientSecret)
      .update(input.clientId + input.accessToken + input.t + input.nonce + input.stringToSign, 'utf8')
      .digest('hex')
      .toUpperCase()

    const signature = await signTuyaRequest(input)

    expect(signature).toBe(expected)
  })
})
