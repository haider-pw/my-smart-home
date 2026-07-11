import { desc, eq } from 'drizzle-orm'
import { PKT_OFFSET_MS } from '../../../shared/utils/pkt-time'
import * as schema from '../../db/schema'
import { useDb } from '../../utils/db'
import { energyByDevice } from '../../utils/reports'
import { getTariffConfig } from '../../utils/tariff-settings'

/**
 * GET /api/reports/bills — stored official bills with our measured units for
 * each bill's cycle window (reading-day anchored), enabling billed-vs-measured
 * auditing. Measured is null when our history doesn't cover the window.
 */
export default defineEventHandler(async () => {
  const db = useDb()
  const { config } = await getTariffConfig(db)
  const anchor = Math.min(Math.max(config.cycleAnchorDay, 1), 28)

  const [rows, breaker, firstHour] = await Promise.all([
    db.select().from(schema.bills).orderBy(desc(schema.bills.billMonth)).all(),
    db.select().from(schema.devices).where(eq(schema.devices.role, 'breaker')).get(),
    db.select({ hourStart: schema.energyHourly.hourStart })
      .from(schema.energyHourly)
      .orderBy(schema.energyHourly.hourStart)
      .limit(1)
      .get()
  ])

  const dataStart = firstHour?.hourStart ?? Number.POSITIVE_INFINITY

  const bills = await Promise.all(rows.map(async (bill) => {
    // Bill month 'YYYY-MM' → cycle window [anchor of previous month, anchor of bill month)
    const [y, m] = bill.billMonth.split('-').map(Number)
    const endTs = Date.UTC(y!, m! - 1, anchor) - PKT_OFFSET_MS
    const startTs = Date.UTC(y!, m! - 2, anchor) - PKT_OFFSET_MS

    // Partial coverage counts too: measure whatever slice of the window our
    // history covers and report the coverage share — the July bill (history
    // began mid-window) shows a qualified number instead of nothing.
    let measuredKwh: number | null = null
    let coveragePct: number | null = null
    const effectiveStart = Math.max(startTs, dataStart)
    if (breaker && effectiveStart < endTs) {
      const energy = await energyByDevice(db, effectiveStart, endTs)
      measuredKwh = energy.find(e => e.deviceId === breaker.id)?.kwh ?? 0
      coveragePct = Math.round(((endTs - effectiveStart) / (endTs - startTs)) * 100)
    }

    return {
      ...bill,
      windowStartTs: startTs,
      windowEndTs: endTs,
      measuredKwh,
      coveragePct,
      // Delta is only meaningful against a (nearly) fully measured window
      deltaPct: measuredKwh !== null && (coveragePct ?? 0) >= 95 && bill.units && bill.units > 0
        ? Math.round(((measuredKwh - bill.units) / bill.units) * 100)
        : null
    }
  }))

  return { success: true as const, data: { bills, anchorDay: anchor }, error: null }
})
