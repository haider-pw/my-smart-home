import { desc, gte } from 'drizzle-orm'
import { pktHourOfDay } from '../../../shared/utils/pkt-time'
import * as schema from '../../db/schema'
import { useDb } from '../../utils/db'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * GET /api/reports/outages?days=90 — the load-shedding log:
 * classified outage list + aggregate stats + hour-of-day pattern.
 */
export default defineEventHandler(async (event) => {
  const days = Math.min(Math.max(Number(getQuery(event).days) || 90, 1), 3660)
  const db = useDb()
  const from = Date.now() - days * DAY_MS

  const rows = await db.select()
    .from(schema.outages)
    .where(gte(schema.outages.startTs, from))
    .orderBy(desc(schema.outages.startTs))
    .all()

  const power = rows.filter(o => o.kind === 'power')
  const internet = rows.filter(o => o.kind === 'internet')

  // hour-of-day histogram (PKT) for power outages — the load-shedding pattern
  const hourHistogram = Array.from({ length: 24 }, () => 0)
  for (const o of power) {
    hourHistogram[pktHourOfDay(o.startTs)]!++
  }

  const totalPowerMin = power.reduce((a, o) => a + (o.durationMin ?? 0), 0)

  return {
    success: true as const,
    data: {
      days,
      outages: rows,
      stats: {
        powerCount: power.length,
        internetCount: internet.length,
        unknownCount: rows.length - power.length - internet.length,
        totalPowerMinutes: Math.round(totalPowerMin),
        avgPowerMinutes: power.length > 0 ? Math.round(totalPowerMin / power.length) : 0,
        longestPowerMinutes: Math.round(Math.max(0, ...power.map(o => o.durationMin ?? 0)))
      },
      hourHistogram
    },
    error: null
  }
})
