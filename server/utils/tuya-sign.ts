/**
 * Tuya OpenAPI v2 request signing — pure functions, no Nuxt/Nitro dependencies.
 *
 * Uses WebCrypto only (crypto.subtle) so the same code runs on Node 22 (local dev)
 * and Cloudflare Workers (production) without node:crypto compatibility flags.
 *
 * Signing scheme (https://developer.tuya.com/en/docs/iot/new-singnature):
 *   stringToSign = METHOD \n SHA256(body) \n signedHeaders \n pathWithSortedQuery
 *   token call:    sign = HMAC-SHA256(clientId + t + nonce + stringToSign, secret)
 *   business call: sign = HMAC-SHA256(clientId + accessToken + t + nonce + stringToSign, secret)
 *   sign is hex, uppercase.
 */

export type TuyaQueryValue = string | number | boolean
export type TuyaQuery = Record<string, TuyaQueryValue | undefined>

export interface TuyaSignInput {
  clientId: string
  clientSecret: string
  /** 13-digit millisecond timestamp as string */
  t: string
  nonce: string
  /** Present on business calls, absent on token calls */
  accessToken?: string
  stringToSign: string
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Lowercase hex SHA-256 of a UTF-8 string. */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return toHex(digest)
}

/** Uppercase hex HMAC-SHA256 — Tuya requires uppercase signatures. */
export async function hmacSha256HexUpper(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message))
  return toHex(signature).toUpperCase()
}

/**
 * Tuya requires query params sorted alphabetically by key in the signed URL.
 * undefined values are dropped. Values are URL-encoded.
 */
export function buildPathWithQuery(path: string, query?: TuyaQuery): string {
  if (!query) {
    return path
  }
  const pairs = Object.entries(query)
    .filter((entry): entry is [string, TuyaQueryValue] => entry[1] !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
  return pairs.length > 0 ? `${path}?${pairs.join('&')}` : path
}

/** Builds Tuya's stringToSign. We never use Signature-Headers, so that section is empty. */
export async function buildStringToSign(
  method: string,
  path: string,
  query?: TuyaQuery,
  body?: string
): Promise<string> {
  const contentHash = await sha256Hex(body ?? '')
  return [method.toUpperCase(), contentHash, '', buildPathWithQuery(path, query)].join('\n')
}

/** Final request signature for the `sign` header. */
export async function signTuyaRequest(input: TuyaSignInput): Promise<string> {
  const message
    = input.clientId
      + (input.accessToken ?? '')
      + input.t
      + input.nonce
      + input.stringToSign
  return hmacSha256HexUpper(input.clientSecret, message)
}
