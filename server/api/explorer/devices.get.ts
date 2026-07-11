import { requireSharedSecret } from '../../utils/admin-guard'
import { sanitizeDevice } from '../../utils/sanitize'
import { currentTuyaRegion, listTuyaDevices } from '../../utils/tuya'

/**
 * GET /api/explorer/devices — all devices on the linked Smart Life account,
 * including their live status DPs (the list endpoint embeds them).
 *
 * Responses are sanitized (no local_key / coordinates / ip / uid) and the
 * endpoint is secret-guarded outside local dev — this app deploys publicly.
 */
export default defineEventHandler(async (event) => {
  requireSharedSecret(event)
  try {
    const devices = await listTuyaDevices()
    return {
      success: true as const,
      data: {
        region: currentTuyaRegion(),
        count: devices.length,
        devices: devices.map(sanitizeDevice)
      },
      error: null
    }
  } catch (error: unknown) {
    const err = error as { statusCode?: number, message?: string }
    setResponseStatus(event, err.statusCode ?? 502)
    return {
      success: false as const,
      data: null,
      error: err.message ?? 'Failed to reach the Tuya API'
    }
  }
})
