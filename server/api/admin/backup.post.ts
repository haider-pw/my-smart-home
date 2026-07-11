import { requireSharedSecret } from '../../utils/admin-guard'
import { createBackup } from '../../utils/backup'
import { useDb } from '../../utils/db'

/** POST /api/admin/backup — dump the database to R2 (Cronicle nightly / manual). */
export default defineEventHandler(async (event) => {
  requireSharedSecret(event)
  const db = useDb()
  try {
    const summary = await createBackup(db)
    return { success: true as const, data: summary, error: null }
  } catch (error: unknown) {
    const err = error as { statusCode?: number, message?: string }
    setResponseStatus(event, err.statusCode ?? 502)
    return { success: false as const, data: null, error: err.message ?? 'backup failed' }
  }
})
