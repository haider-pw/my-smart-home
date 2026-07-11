/**
 * Database backup + restore. The Turso DB is the only irreplaceable asset
 * (Tuya keeps just 7 days), so this dumps every meaningful table to a gzipped
 * JSON snapshot in R2 backups/ nightly, with tiered retention, and provides a
 * verified restore path.
 */
import { eq } from 'drizzle-orm'
import * as schema from '../db/schema'
import type { Db } from './db'
import { isR2Configured, r2Delete, r2GetBytes, r2List, r2Put } from './r2'
import { keysToPrune, parseBackupTs } from './backup-retention'

const BACKUP_PREFIX = 'backups/'
const LAST_BACKUP_KEY = 'last_backup'
const SCHEMA_VERSION = 1

// Tables worth preserving. auth_attempts (transient rate-limit rows) is skipped.
const BACKUP_TABLES = [
  'devices', 'readings', 'registerSnapshots', 'energyEvents', 'energyHourly',
  'energyDaily', 'deviceEvents', 'outages', 'alerts', 'pushSubscriptions',
  'settings', 'syncState', 'bills'
] as const

type TableName = typeof BACKUP_TABLES[number]

interface BackupFile {
  meta: { version: number, createdAt: number, tables: Record<string, number> }
  data: Record<string, unknown[]>
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Response(text).body!.pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function gunzip(bytes: Uint8Array): Promise<string> {
  // Cast: the DOM lib's BodyInit union lags behind Uint8Array's generic type
  const stream = new Response(bytes as BodyInit).body!.pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

export interface BackupSummary {
  key: string
  bytes: number
  rows: number
  pruned: number
}

/** Dump every table → gzipped JSON → R2, then prune per the retention policy. */
export async function createBackup(db: Db): Promise<BackupSummary> {
  if (!isR2Configured()) {
    throw createError({ statusCode: 503, message: 'Backups need the NUXT_R2_* environment variables' })
  }
  const now = Date.now()
  const file: BackupFile = { meta: { version: SCHEMA_VERSION, createdAt: now, tables: {} }, data: {} }
  let totalRows = 0

  for (const table of BACKUP_TABLES) {
    const rows = await db.select().from(schema[table]).all()
    file.data[table] = rows
    file.meta.tables[table] = rows.length
    totalRows += rows.length
  }

  const payload = await gzip(JSON.stringify(file))
  // Timestamped to the second so manual + scheduled runs never collide
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const key = `${BACKUP_PREFIX}${stamp}.json.gz`
  await r2Put(key, payload, 'application/gzip')

  // Record heartbeat for the Settings status line
  await db.insert(schema.syncState)
    .values({ key: LAST_BACKUP_KEY, value: JSON.stringify({ at: now, key, rows: totalRows, bytes: payload.length }), updatedAt: now })
    .onConflictDoUpdate({
      target: schema.syncState.key,
      set: { value: JSON.stringify({ at: now, key, rows: totalRows, bytes: payload.length }), updatedAt: now }
    })

  // Prune
  const all = await r2List(BACKUP_PREFIX)
  const objects = all
    .map(k => ({ key: k, ts: parseBackupTs(k) }))
    .filter((o): o is { key: string, ts: number } => o.ts !== null)
  const prune = keysToPrune(objects, now)
  for (const k of prune) {
    await r2Delete(k)
  }

  return { key, bytes: payload.length, rows: totalRows, pruned: prune.length }
}

export interface RestoreSummary {
  key: string
  restoredTables: Record<string, number>
}

/**
 * Restore from a backup object. DESTRUCTIVE: clears each backed-up table and
 * reloads it. Guarded hard at the endpoint layer.
 */
export async function restoreBackup(db: Db, key: string): Promise<RestoreSummary> {
  const bytes = await r2GetBytes(key)
  if (!bytes) {
    throw createError({ statusCode: 404, message: `Backup not found: ${key}` })
  }
  const file = JSON.parse(await gunzip(bytes)) as BackupFile
  if (file.meta?.version !== SCHEMA_VERSION) {
    throw createError({ statusCode: 422, message: `Unsupported backup version ${file.meta?.version}` })
  }

  const restored: Record<string, number> = {}
  for (const table of BACKUP_TABLES) {
    const rows = (file.data[table] ?? []) as Record<string, unknown>[]
    await db.delete(schema[table])
    // Chunk inserts to stay well under libSQL statement limits
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200)
      if (chunk.length > 0) {
        await db.insert(schema[table as TableName]).values(chunk as never).onConflictDoNothing()
      }
    }
    restored[table] = rows.length
  }
  return { key, restoredTables: restored }
}

export interface BackupStatus {
  lastAt: number | null
  lastKey: string | null
  lastRows: number | null
  lastBytes: number | null
  count: number
}

export async function backupStatus(db: Db): Promise<BackupStatus> {
  const row = await db.select().from(schema.syncState).where(eq(schema.syncState.key, LAST_BACKUP_KEY)).get()
  const parsed = row ? JSON.parse(row.value) as { at: number, key: string, rows: number, bytes: number } : null
  const count = isR2Configured() ? (await r2List(BACKUP_PREFIX)).filter(k => k.endsWith('.json.gz')).length : 0
  return {
    lastAt: parsed?.at ?? null,
    lastKey: parsed?.key ?? null,
    lastRows: parsed?.rows ?? null,
    lastBytes: parsed?.bytes ?? null,
    count
  }
}

export async function listBackups(): Promise<string[]> {
  if (!isR2Configured()) {
    return []
  }
  return (await r2List(BACKUP_PREFIX)).filter(k => k.endsWith('.json.gz')).sort().reverse()
}
