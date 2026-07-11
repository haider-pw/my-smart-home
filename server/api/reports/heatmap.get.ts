import { pktDayStart } from '../../../shared/utils/pkt-time'
import { useDb } from '../../utils/db'
import { heatmapMatrix } from '../../utils/reports'

const DAY_MS = 24 * 60 * 60 * 1000

/** GET /api/reports/heatmap?days=7 — day × hour kWh matrix (PKT). */
export default defineEventHandler(async (event) => {
  const days = Math.min(Math.max(Number(getQuery(event).days) || 7, 1), 31)
  const db = useDb()
  const now = Date.now()
  const from = pktDayStart(now - (days - 1) * DAY_MS)

  const cells = await heatmapMatrix(db, from, now)
  return { success: true as const, data: { from, cells }, error: null }
})
