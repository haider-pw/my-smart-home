import { requireSharedSecret } from '../../utils/admin-guard'
import { runBackfill } from '../../utils/backfill'

/** POST /api/admin/backfill — pull Tuya's ~7-day log history into our DB. */
export default defineEventHandler(async (event) => {
  requireSharedSecret(event)
  const body = await readBody<{ days?: number }>(event).catch(() => ({} as { days?: number }))
  const days = Math.min(Math.max(body?.days ?? 7, 1), 7)
  const summary = await runBackfill(days)
  return { success: true as const, data: summary, error: null }
})
