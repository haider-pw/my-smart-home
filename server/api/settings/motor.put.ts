import { and, eq } from 'drizzle-orm'
import * as schema from '../../db/schema'
import { useDb } from '../../utils/db'

/** Nameplate ratings outside this range are almost certainly typos. */
const MIN_WATTS = 50
const MAX_WATTS = 7500

/**
 * PUT /api/settings/motor — sets the rated power (watts) of a switch-role
 * device. Drives the runtime → kWh estimation for non-metering relays.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ deviceId?: unknown, ratedWatts?: unknown }>(event).catch(() => null)
  const deviceId = typeof body?.deviceId === 'string' ? body.deviceId : null
  const ratedWatts = typeof body?.ratedWatts === 'number' ? Math.round(body.ratedWatts) : null

  if (!deviceId || ratedWatts === null || ratedWatts < MIN_WATTS || ratedWatts > MAX_WATTS) {
    setResponseStatus(event, 400)
    return {
      success: false as const,
      data: null,
      error: `deviceId and ratedWatts (${MIN_WATTS}–${MAX_WATTS} W) required`
    }
  }

  const db = useDb()
  const updated = await db.update(schema.devices)
    .set({ ratedWatts })
    .where(and(eq(schema.devices.id, deviceId), eq(schema.devices.role, 'switch')))
    .returning({ id: schema.devices.id, name: schema.devices.name, ratedWatts: schema.devices.ratedWatts })

  if (updated.length === 0) {
    setResponseStatus(event, 404)
    return { success: false as const, data: null, error: 'No switch device with that id' }
  }

  return { success: true as const, data: updated[0], error: null }
})
