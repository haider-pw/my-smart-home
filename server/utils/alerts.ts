/**
 * Alert evaluation — runs at the end of every poll cycle. Deduplication is
 * key-based in sync_state so serverless re-runs never double-notify.
 */
import { eq } from 'drizzle-orm'
import { pktDayKey, pktDayStart } from '../../shared/utils/pkt-time'
import { estimateCostPkr, projectBill, slabEnergyCost } from '../../shared/utils/tariff'
import * as schema from '../db/schema'
import type { Db } from './db'
import type { OutageSyncResult } from './outage-sync'
import { sendPushToAll } from './push'
import { energyByDevice } from './reports'
import { getTariffConfig } from './tariff-settings'

const fmt = (n: number) => Math.round(n).toLocaleString('en-IN')

async function alertOnce(db: Db, dedupKey: string, type: string, title: string, body: string, url = '/'): Promise<boolean> {
  const key = `alert:${dedupKey}`
  const existing = await db.select().from(schema.syncState).where(eq(schema.syncState.key, key)).get()
  if (existing) {
    return false
  }
  await db.insert(schema.syncState).values({ key, value: '1', updatedAt: Date.now() }).onConflictDoNothing()
  await db.insert(schema.alerts).values({ type, ts: Date.now(), payload: { title, body }, delivered: true })
  await sendPushToAll(db, { title, body, url, tag: type })
  return true
}

export async function evaluateAlerts(db: Db, breakerId: string | null, outageSync: OutageSyncResult): Promise<number> {
  let fired = 0
  const now = Date.now()
  const { config } = await getTariffConfig(db)
  const { cycle } = projectBill(0, now, config)

  // Cycle units (breaker = house total)
  const cycleEnergy = await energyByDevice(db, cycle.startTs, now)
  const cycleUnits = breakerId
    ? cycleEnergy.find(e => e.deviceId === breakerId)?.kwh ?? 0
    : cycleEnergy.reduce((a, e) => a + e.kwh, 0)

  // 1. Slab approach / crossing (slab meters only — TOU has no cliffs)
  if (config.meterType === 'single-phase') {
    const slabs = config.slabs[config.category]
    const pos = slabEnergyCost(cycleUnits, slabs, config.previousSlabBenefitDepth[config.category])
    if (Number.isFinite(pos.unitsToNextSlab) && pos.unitsToNextSlab < 40) {
      const next = slabs[pos.slabIndex + 1]
      if (await alertOnce(db, `slab:${cycle.startTs}:${pos.slabIndex}`, 'slab-approach',
        `⚠ ${fmt(pos.unitsToNextSlab)} units from the next slab`,
        `Crossing lifts the rate from Rs ${pos.marginalRate} to Rs ${next?.rate ?? '—'}/unit and reprices earlier units. ${fmt(cycleUnits)} units used this cycle.`)) {
        fired++
      }
    }
  }

  // 2. Projection crosses the red budget line (once per cycle)
  const projectedUnits = cycleUnits * ((cycle.endTs - cycle.startTs) / Math.max(now - cycle.startTs, 1))
  const projectedPkr = estimateCostPkr(projectedUnits, config)
  if (projectedPkr > config.budget.red && cycle.daysElapsed >= 3) {
    if (await alertOnce(db, `projred:${cycle.startTs}`, 'projection-red',
      `🔴 Projected bill Rs ${fmt(projectedPkr)}`,
      `This cycle is heading past your Rs ${fmt(config.budget.red)} red line (${fmt(projectedUnits)} units projected).`)) {
      fired++
    }
  }

  // 3. New outages (already deduped by the sweep's UNIQUE(start_ts))
  for (const outage of outageSync.insertedOutages) {
    const icon = outage.kind === 'power' ? '⚡' : outage.kind === 'internet' ? '🌐' : '·'
    const label = outage.kind === 'power' ? 'Power outage' : outage.kind === 'internet' ? 'Internet outage' : 'Outage'
    if (await alertOnce(db, `outage:${outage.startTs}`, 'outage',
      `${icon} ${label} — ${outage.durationMin} min`,
      'Detected via the breaker connectivity log.', '/outages')) {
      fired++
    }
  }

  // 4. Daily spike vs yesterday (once per PKT day, after meaningful volume)
  const todayStart = pktDayStart(now)
  const todayRows = await energyByDevice(db, todayStart, now)
  const todayKwh = breakerId ? todayRows.find(e => e.deviceId === breakerId)?.kwh ?? 0 : 0
  const yRows = await energyByDevice(db, todayStart - 24 * 3600 * 1000, todayStart)
  const yesterdayKwh = breakerId ? yRows.find(e => e.deviceId === breakerId)?.kwh ?? 0 : 0
  if (todayKwh > 6 && yesterdayKwh > 1 && todayKwh > yesterdayKwh * 1.5) {
    if (await alertOnce(db, `spike:${pktDayKey(now)}`, 'spike',
      `📈 Usage spike: ${fmt(todayKwh)} kWh today`,
      `${Math.round((todayKwh / yesterdayKwh - 1) * 100)}% above yesterday (${fmt(yesterdayKwh)} kWh full day). Worth checking what is running.`)) {
      fired++
    }
  }

  return fired
}
