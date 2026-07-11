/**
 * Cloudflare R2 access via the S3 API — aws4fetch keeps it tiny and
 * runtime-agnostic. Bucket stays private; every read flows through the
 * session-gated app, so the PIN wall protects the archives too.
 */
import { AwsClient } from 'aws4fetch'

function r2Config() {
  const { r2 } = useRuntimeConfig()
  if (!r2.accountId || !r2.accessKeyId || !r2.secretAccessKey || !r2.bucket) {
    return null
  }
  return r2
}

export function isR2Configured(): boolean {
  return r2Config() !== null
}

function client(cfg: NonNullable<ReturnType<typeof r2Config>>) {
  return new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    service: 's3',
    region: 'auto'
  })
}

function objectUrl(cfg: NonNullable<ReturnType<typeof r2Config>>, key: string): string {
  return `https://${cfg.accountId}.r2.cloudflarestorage.com/${cfg.bucket}/${key}`
}

/** PUT an object; throws on failure. No-ops (returns false) when R2 unconfigured. */
export async function r2Put(key: string, body: string | Uint8Array, contentType: string): Promise<boolean> {
  const cfg = r2Config()
  if (!cfg) {
    return false
  }
  const res = await client(cfg).fetch(objectUrl(cfg, key), {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: body as BodyInit
  })
  if (!res.ok) {
    throw createError({ statusCode: 502, message: `R2 PUT ${key}: HTTP ${res.status}` })
  }
  return true
}

/** GET an object; null when missing or unconfigured. */
export async function r2Get(key: string): Promise<{ body: ReadableStream | null, contentType: string } | null> {
  const cfg = r2Config()
  if (!cfg) {
    return null
  }
  const res = await client(cfg).fetch(objectUrl(cfg, key))
  if (res.status === 404) {
    return null
  }
  if (!res.ok) {
    throw createError({ statusCode: 502, message: `R2 GET ${key}: HTTP ${res.status}` })
  }
  return { body: res.body, contentType: res.headers.get('content-type') ?? 'application/octet-stream' }
}

/** GET an object as raw bytes; null when missing/unconfigured. */
export async function r2GetBytes(key: string): Promise<Uint8Array | null> {
  const got = await r2Get(key)
  if (!got?.body) {
    return null
  }
  return new Uint8Array(await new Response(got.body).arrayBuffer())
}

/** List object keys under a prefix (paginates the S3 ListObjectsV2 XML). */
export async function r2List(prefix: string): Promise<string[]> {
  const cfg = r2Config()
  if (!cfg) {
    return []
  }
  const keys: string[] = []
  let token: string | undefined
  do {
    const params = new URLSearchParams({ 'list-type': '2', 'prefix': prefix, 'max-keys': '1000' })
    if (token) {
      params.set('continuation-token', token)
    }
    const url = `https://${cfg.accountId}.r2.cloudflarestorage.com/${cfg.bucket}?${params.toString()}`
    const res = await client(cfg).fetch(url)
    if (!res.ok) {
      throw createError({ statusCode: 502, message: `R2 LIST: HTTP ${res.status}` })
    }
    const xml = await res.text()
    for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) {
      keys.push(m[1]!)
    }
    const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml)
    token = truncated ? xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1] : undefined
  } while (token)
  return keys
}

/** DELETE an object (idempotent). */
export async function r2Delete(key: string): Promise<void> {
  const cfg = r2Config()
  if (!cfg) {
    return
  }
  await client(cfg).fetch(objectUrl(cfg, key), { method: 'DELETE' })
}
