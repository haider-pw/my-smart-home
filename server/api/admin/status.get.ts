import { desc, sql } from 'drizzle-orm'
import { requireSharedSecret } from '../../utils/admin-guard'
import * as schema from '../../db/schema'
import { useDb } from '../../utils/db'

/** GET /api/admin/status — table counts + poller heartbeat (ops/debug tool). */
export default defineEventHandler(async (event) => {
  requireSharedSecret(event)
  const db = useDb()

  const [devices, readings, snapshots, events, hourly, outageRows, sync] = await Promise.all([
    db.select().from(schema.devices).all(),
    db.select({ n: sql<number>`count(*)` }).from(schema.readings).get(),
    db.select({ n: sql<number>`count(*)` }).from(schema.registerSnapshots).get(),
    db.select({ n: sql<number>`count(*)` }).from(schema.energyEvents).get(),
    db.select({ n: sql<number>`count(*)` }).from(schema.energyHourly).get(),
    db.select().from(schema.outages).orderBy(desc(schema.outages.startTs)).limit(5).all(),
    db.select().from(schema.syncState).all()
  ])

  return {
    success: true as const,
    data: {
      devices: devices.map(d => ({
        id: d.id,
        name: d.name,
        role: d.role,
        isActive: d.isActive,
        lastOnline: d.lastOnline
      })),
      counts: {
        readings: readings?.n ?? 0,
        registerSnapshots: snapshots?.n ?? 0,
        energyEvents: events?.n ?? 0,
        energyHourly: hourly?.n ?? 0
      },
      recentOutages: outageRows,
      syncState: sync
    },
    error: null
  }
})
