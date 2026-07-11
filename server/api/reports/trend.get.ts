import { pktDayStart, pktHourStart } from '../../../shared/utils/pkt-time'
import { useDb } from '../../utils/db'
import { dailySeries, hourlySeries } from '../../utils/reports'

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_RANGE_DAYS = 370

/**
 * GET /api/reports/trend?bucket=day|hour&days=30&device=<id>
 * Daily (PKT days) or hourly totals; optionally for a single device.
 */
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const bucket = q.bucket === 'hour' ? 'hour' : 'day'
  const days = Math.min(Math.max(Number(q.days) || 30, 1), MAX_RANGE_DAYS)
  const deviceId = typeof q.device === 'string' && q.device.length > 0 ? q.device : undefined

  const db = useDb()
  const now = Date.now()

  if (bucket === 'hour') {
    const from = pktHourStart(now - days * DAY_MS)
    const points = await hourlySeries(db, from, now, deviceId)
    return { success: true as const, data: { bucket, points }, error: null }
  }

  const from = pktDayStart(now - (days - 1) * DAY_MS)
  const points = await dailySeries(db, from, now, deviceId)
  return { success: true as const, data: { bucket, points }, error: null }
})
