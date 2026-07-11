import { getTuyaDevice, getTuyaDeviceSpecification, getTuyaDeviceStatus } from '../../utils/tuya'

/**
 * GET /api/explorer/:id — full detail for one device:
 * metadata, current status DPs, and the capability specification
 * (which DPs exist, their types and ranges — including rated current where exposed).
 */
export default defineEventHandler(async (event) => {
  const deviceId = getRouterParam(event, 'id')
  if (!deviceId) {
    setResponseStatus(event, 400)
    return { success: false as const, data: null, error: 'Device id is required' }
  }

  try {
    const [device, status, specification] = await Promise.all([
      getTuyaDevice(deviceId),
      getTuyaDeviceStatus(deviceId),
      getTuyaDeviceSpecification(deviceId)
    ])
    return {
      success: true as const,
      data: { device, status, specification },
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
