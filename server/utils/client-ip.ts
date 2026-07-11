import type { H3Event } from 'h3'

/**
 * Real visitor IP behind the proxy chain.
 *
 * watt.appz.cc is Cloudflare-proxied in front of Vercel, so plain
 * x-forwarded-for starts with a Cloudflare edge IP. Priority:
 *   1. cf-connecting-ip  — set by Cloudflare, the true client
 *   2. x-real-ip         — set by Vercel
 *   3. h3's getRequestIP (x-forwarded-for first hop / socket)
 */
export function getClientIp(event: H3Event): string | undefined {
  return getHeader(event, 'cf-connecting-ip')
    ?? getHeader(event, 'x-real-ip')
    ?? getRequestIP(event, { xForwardedFor: true })
}
