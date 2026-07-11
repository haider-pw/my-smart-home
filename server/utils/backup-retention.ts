/**
 * Backup retention policy — pure function so it's unit-testable without R2.
 *
 * Keeps: every backup from the last DAILY_KEEP_DAYS, plus the newest backup
 * of each month for MONTHLY_KEEP_MONTHS. Everything else is pruned.
 */

const DAILY_KEEP_DAYS = 14
const MONTHLY_KEEP_MONTHS = 12
const DAY_MS = 24 * 60 * 60 * 1000

export interface BackupObject {
  key: string
  /** UTC epoch ms parsed from the key's YYYY-MM-DD */
  ts: number
}

/** Parse `backups/YYYY-MM-DD[...].json.gz` → epoch ms (UTC midnight), or null. */
export function parseBackupTs(key: string): number | null {
  const m = key.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (!m) {
    return null
  }
  const ts = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isFinite(ts) ? ts : null
}

/**
 * Given all backup objects and "now", returns the keys that should be DELETED.
 */
export function keysToPrune(objects: BackupObject[], nowTs: number): string[] {
  const dailyCutoff = nowTs - DAILY_KEEP_DAYS * DAY_MS
  const monthlyCutoff = nowTs - MONTHLY_KEEP_MONTHS * 31 * DAY_MS

  // Newest backup per calendar month (for the monthly tier)
  const newestPerMonth = new Map<string, BackupObject>()
  for (const obj of objects) {
    const monthKey = new Date(obj.ts).toISOString().slice(0, 7)
    const existing = newestPerMonth.get(monthKey)
    if (!existing || obj.ts > existing.ts) {
      newestPerMonth.set(monthKey, obj)
    }
  }
  const monthlyKept = new Set(Array.from(newestPerMonth.values()).map(o => o.key))

  const toDelete: string[] = []
  for (const obj of objects) {
    const withinDaily = obj.ts >= dailyCutoff
    const isMonthlyKeeper = obj.ts >= monthlyCutoff && monthlyKept.has(obj.key)
    if (!withinDaily && !isMonthlyKeeper) {
      toDelete.push(obj.key)
    }
  }
  return toDelete
}
