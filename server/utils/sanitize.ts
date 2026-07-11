import type { TuyaDevice, TuyaDeviceStatusItem } from './tuya'

/**
 * Public-safe projection of a Tuya device. Tuya's raw device objects include
 * fields that must NEVER leave the server on a public deployment:
 * local_key (device control key), lat/lon (home coordinates), ip, uid,
 * owner_id. We whitelist instead of blacklisting so new upstream fields
 * stay private by default.
 */
export interface SafeDevice {
  id: string
  name: string
  category: string
  product_name?: string
  online: boolean
  sub?: boolean
  create_time?: number
  update_time?: number
  status?: TuyaDeviceStatusItem[]
}

export function sanitizeDevice(device: TuyaDevice): SafeDevice {
  return {
    id: device.id,
    name: device.name,
    category: device.category,
    product_name: device.product_name,
    online: device.online,
    sub: typeof device.sub === 'boolean' ? device.sub : undefined,
    create_time: device.create_time,
    update_time: device.update_time,
    status: device.status
  }
}
