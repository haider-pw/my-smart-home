/**
 * IP allowlist matching — pure functions, no Nuxt dependencies.
 *
 * Supports IPv4 exact ("39.50.1.2") and CIDR ("39.50.0.0/16") entries.
 * IPv6 is matched exactly (rare for the owner's use case); IPv4-mapped
 * IPv6 addresses ("::ffff:39.50.1.2") are unwrapped before matching.
 */

function ipv4ToUint32(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) {
    return null
  }
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null
    }
    const octet = Number(part)
    if (octet > 255) {
      return null
    }
    value = (value * 256) + octet
  }
  return value
}

/** Strips the IPv4-mapped IPv6 prefix if present. */
export function normalizeIp(ip: string): string {
  const trimmed = ip.trim()
  if (trimmed.toLowerCase().startsWith('::ffff:') && trimmed.includes('.')) {
    return trimmed.slice(7)
  }
  return trimmed
}

function matchesEntry(ip: string, entry: string): boolean {
  if (!entry.includes('/')) {
    return ip === entry
  }
  const [network, lenStr] = entry.split('/')
  const prefixLen = Number(lenStr)
  if (!network || !Number.isInteger(prefixLen) || prefixLen < 0 || prefixLen > 32) {
    return false
  }
  const ipNum = ipv4ToUint32(ip)
  const netNum = ipv4ToUint32(network)
  if (ipNum === null || netNum === null) {
    return false
  }
  if (prefixLen === 0) {
    return true
  }
  const mask = (0xFFFFFFFF << (32 - prefixLen)) >>> 0
  return ((ipNum & mask) >>> 0) === ((netNum & mask) >>> 0)
}

/**
 * Is `ip` covered by the comma-separated allowlist?
 * Empty/undefined list matches nothing.
 */
export function isIpAllowed(ip: string | undefined | null, allowlistCsv: string): boolean {
  if (!ip || !allowlistCsv.trim()) {
    return false
  }
  const normalized = normalizeIp(ip)
  return allowlistCsv
    .split(',')
    .map(entry => normalizeIp(entry))
    .filter(entry => entry.length > 0)
    .some(entry => matchesEntry(normalized, entry))
}
