/**
 * Tuya Cloud API client — token management, region auto-detection, and
 * typed wrappers for the device endpoints Phase 0 needs.
 *
 * Secrets come exclusively from runtimeConfig (NUXT_TUYA_* env vars).
 */
import {
  buildPathWithQuery,
  buildStringToSign,
  signTuyaRequest,
  type TuyaQuery
} from './tuya-sign'

export const TUYA_ENDPOINTS: Record<string, string> = {
  in: 'https://openapi.tuyain.com',
  eu: 'https://openapi.tuyaeu.com',
  us: 'https://openapi.tuyaus.com',
  cn: 'https://openapi.tuyacn.com'
}

interface TuyaApiResponse<T> {
  success: boolean
  code?: number
  msg?: string
  result: T
  t?: number
}

interface TuyaTokenResult {
  access_token: string
  refresh_token: string
  /** seconds until expiry */
  expire_time: number
  uid: string
}

export interface TuyaDeviceStatusItem {
  code: string
  value: unknown
}

export interface TuyaDevice {
  id: string
  name: string
  category: string
  product_name?: string
  product_id?: string
  online: boolean
  ip?: string
  time_zone?: string
  create_time?: number
  update_time?: number
  status?: TuyaDeviceStatusItem[]
  [key: string]: unknown
}

export interface TuyaSpecFunction {
  code: string
  type: string
  values: string
}

export interface TuyaDeviceSpecification {
  category: string
  functions: TuyaSpecFunction[]
  status: TuyaSpecFunction[]
}

const TOKEN_REFRESH_MARGIN_MS = 60_000
const TUYA_CODE_TOKEN_INVALID = 1010
const TUYA_CODE_TOKEN_EXPIRED = 1011

// Module-scope caches. On Workers these live per-isolate, which is fine:
// worst case is one extra token round-trip after a cold start.
let cachedToken: { token: string, expiresAt: number } | null = null
let detectedBaseUrl: string | null = null

interface TuyaCreds {
  clientId: string
  clientSecret: string
  region: string
}

function getTuyaCreds(): TuyaCreds {
  const { tuya } = useRuntimeConfig()
  if (!tuya.clientId || !tuya.clientSecret) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Tuya credentials missing',
      message: 'Set NUXT_TUYA_CLIENT_ID and NUXT_TUYA_CLIENT_SECRET in .env (copy .env.example)'
    })
  }
  return { clientId: tuya.clientId, clientSecret: tuya.clientSecret, region: tuya.region }
}

interface RawRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  query?: TuyaQuery
  body?: unknown
  accessToken?: string
}

async function rawTuyaRequest<T>(
  baseUrl: string,
  path: string,
  creds: TuyaCreds,
  options: RawRequestOptions = {}
): Promise<TuyaApiResponse<T>> {
  const method = options.method ?? 'GET'
  const bodyStr = options.body === undefined ? '' : JSON.stringify(options.body)
  const t = Date.now().toString()
  const nonce = crypto.randomUUID()

  const stringToSign = await buildStringToSign(method, path, options.query, bodyStr)
  const sign = await signTuyaRequest({
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    t,
    nonce,
    accessToken: options.accessToken,
    stringToSign
  })

  // The fetched URL must byte-for-byte match the signed one — build it ourselves.
  const url = baseUrl + buildPathWithQuery(path, options.query)

  return $fetch<TuyaApiResponse<T>>(url, {
    method,
    headers: {
      'client_id': creds.clientId,
      'sign': sign,
      't': t,
      'nonce': nonce,
      'sign_method': 'HMAC-SHA256',
      ...(options.accessToken ? { access_token: options.accessToken } : {}),
      'Content-Type': 'application/json'
    },
    body: bodyStr === '' ? undefined : bodyStr
  })
}

async function requestToken(baseUrl: string, creds: TuyaCreds): Promise<TuyaApiResponse<TuyaTokenResult>> {
  return rawTuyaRequest<TuyaTokenResult>(baseUrl, '/v1.0/token', creds, {
    query: { grant_type: 1 }
  })
}

/**
 * Resolves the correct data-center endpoint. Uses NUXT_TUYA_REGION when set,
 * otherwise tries each region's token endpoint once and caches the winner.
 */
async function resolveBaseUrl(creds: TuyaCreds): Promise<string> {
  if (creds.region) {
    const url = TUYA_ENDPOINTS[creds.region]
    if (!url) {
      throw createError({
        statusCode: 500,
        message: `Invalid NUXT_TUYA_REGION "${creds.region}" — use one of: ${Object.keys(TUYA_ENDPOINTS).join(', ')}`
      })
    }
    return url
  }
  if (detectedBaseUrl) {
    return detectedBaseUrl
  }

  const failures: string[] = []
  for (const [region, url] of Object.entries(TUYA_ENDPOINTS)) {
    try {
      const res = await requestToken(url, creds)
      if (res.success) {
        detectedBaseUrl = url
        cachedToken = {
          token: res.result.access_token,
          expiresAt: Date.now() + res.result.expire_time * 1000
        }
        return url
      }
      failures.push(`${region}: ${res.code} ${res.msg}`)
    } catch (error: unknown) {
      failures.push(`${region}: ${error instanceof Error ? error.message : 'request failed'}`)
    }
  }
  throw createError({
    statusCode: 502,
    statusMessage: 'Tuya region auto-detection failed',
    message: `No data center accepted the credentials. Tried → ${failures.join(' | ')}`
  })
}

async function getAccessToken(creds: TuyaCreds, baseUrl: string): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) {
    return cachedToken.token
  }
  const res = await requestToken(baseUrl, creds)
  if (!res.success) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Tuya token request failed',
      message: `Tuya ${res.code}: ${res.msg}`
    })
  }
  cachedToken = {
    token: res.result.access_token,
    expiresAt: Date.now() + res.result.expire_time * 1000
  }
  return cachedToken.token
}

/** Signed GET against the Tuya API with automatic token acquisition + one retry on expiry. */
export async function tuyaGet<T>(path: string, query?: TuyaQuery): Promise<T> {
  const creds = getTuyaCreds()
  const baseUrl = await resolveBaseUrl(creds)
  let token = await getAccessToken(creds, baseUrl)

  let res = await rawTuyaRequest<T>(baseUrl, path, creds, { query, accessToken: token })
  if (!res.success && (res.code === TUYA_CODE_TOKEN_INVALID || res.code === TUYA_CODE_TOKEN_EXPIRED)) {
    cachedToken = null
    token = await getAccessToken(creds, baseUrl)
    res = await rawTuyaRequest<T>(baseUrl, path, creds, { query, accessToken: token })
  }
  if (!res.success) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Tuya API error',
      message: `Tuya ${res.code}: ${res.msg} (${path})`
    })
  }
  return res.result
}

/** Which region we ended up talking to — surfaced in the explorer UI. */
export function currentTuyaRegion(): string | null {
  const { tuya } = useRuntimeConfig()
  if (tuya.region) {
    return tuya.region
  }
  if (!detectedBaseUrl) {
    return null
  }
  const match = Object.entries(TUYA_ENDPOINTS).find(([, url]) => url === detectedBaseUrl)
  return match ? match[0] : null
}

/**
 * Lists devices of the linked Smart Life account.
 * Primary: Smart Home Basic endpoint. Fallback: IoT Core device listing
 * (field names differ there, so we normalize).
 */
export async function listTuyaDevices(): Promise<TuyaDevice[]> {
  try {
    const result = await tuyaGet<{ devices: TuyaDevice[] }>(
      '/v1.0/iot-01/associated-users/devices',
      { size: 100 }
    )
    return result.devices ?? []
  } catch (primaryError: unknown) {
    interface IotCoreDevice {
      id: string
      name: string
      category: string
      productName?: string
      productId?: string
      isOnline?: boolean
      [key: string]: unknown
    }
    try {
      const result = await tuyaGet<IotCoreDevice[]>('/v2.0/cloud/thing/device', { page_size: 100 })
      return (result ?? []).map(d => ({
        ...d,
        product_name: d.productName,
        product_id: d.productId,
        online: d.isOnline === true
      }))
    } catch {
      // Surface the primary error — it usually carries the actionable Tuya code/msg.
      throw primaryError
    }
  }
}

export async function getTuyaDevice(deviceId: string): Promise<TuyaDevice> {
  return tuyaGet<TuyaDevice>(`/v1.0/devices/${deviceId}`)
}

export async function getTuyaDeviceStatus(deviceId: string): Promise<TuyaDeviceStatusItem[]> {
  return tuyaGet<TuyaDeviceStatusItem[]>(`/v1.0/devices/${deviceId}/status`)
}

export async function getTuyaDeviceSpecification(deviceId: string): Promise<TuyaDeviceSpecification | null> {
  try {
    return await tuyaGet<TuyaDeviceSpecification>(`/v1.0/devices/${deviceId}/specifications`)
  } catch {
    try {
      return await tuyaGet<TuyaDeviceSpecification>(`/v1.2/iot-03/devices/${deviceId}/specification`)
    } catch {
      // Spec endpoint availability varies by plan/region — the explorer degrades gracefully.
      return null
    }
  }
}
