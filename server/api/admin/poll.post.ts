import { requireSharedSecret } from '../../utils/admin-guard'
import { pollDevices } from '../../utils/poller'

/** POST /api/admin/poll — manually trigger one poll cycle (ops/debug tool). */
export default defineEventHandler(async (event) => {
  requireSharedSecret(event)
  const summary = await pollDevices()
  return { success: true as const, data: summary, error: null }
})
