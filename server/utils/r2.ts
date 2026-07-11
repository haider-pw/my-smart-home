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
