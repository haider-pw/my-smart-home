import { backupStatus } from '../../utils/backup'
import { useDb } from '../../utils/db'

/** GET /api/reports/backup-status — for the Settings status line. */
export default defineEventHandler(async () => {
  const db = useDb()
  return { success: true as const, data: await backupStatus(db), error: null }
})
