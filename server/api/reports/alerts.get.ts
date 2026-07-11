import { desc } from 'drizzle-orm'
import * as schema from '../../db/schema'
import { useDb } from '../../utils/db'

/** GET /api/reports/alerts — recent alert history. */
export default defineEventHandler(async () => {
  const db = useDb()
  const rows = await db.select().from(schema.alerts).orderBy(desc(schema.alerts.ts)).limit(30).all()
  return { success: true as const, data: { alerts: rows }, error: null }
})
