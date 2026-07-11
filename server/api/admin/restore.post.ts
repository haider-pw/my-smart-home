import { requireSharedSecret } from '../../utils/admin-guard'
import { listBackups, restoreBackup } from '../../utils/backup'
import { useDb } from '../../utils/db'

/**
 * POST /api/admin/restore { key, confirm: "RESTORE" } — DESTRUCTIVE.
 * Wipes the backed-up tables and reloads from the snapshot. Requires the
 * shared secret AND an explicit confirm token so it can never fire by accident.
 */
export default defineEventHandler(async (event) => {
  requireSharedSecret(event)
  const body = await readBody<{ key?: string, confirm?: string }>(event)
  if (body?.confirm !== 'RESTORE') {
    setResponseStatus(event, 400)
    return { success: false as const, data: null, error: 'Pass { confirm: "RESTORE" } to authorize this destructive operation' }
  }
  // Default to the newest backup when no key is given
  const key = body.key ?? (await listBackups())[0]
  if (!key) {
    setResponseStatus(event, 404)
    return { success: false as const, data: null, error: 'No backup available to restore' }
  }
  const db = useDb()
  try {
    const summary = await restoreBackup(db, key)
    return { success: true as const, data: summary, error: null }
  } catch (error: unknown) {
    const err = error as { statusCode?: number, message?: string }
    setResponseStatus(event, err.statusCode ?? 502)
    return { success: false as const, data: null, error: err.message ?? 'restore failed' }
  }
})
