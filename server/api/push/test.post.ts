import { useDb } from '../../utils/db'
import { sendPushToAll } from '../../utils/push'

/** POST /api/push/test — send a test notification to every subscription. */
export default defineEventHandler(async () => {
  const db = useDb()
  const result = await sendPushToAll(db, {
    title: '⚡ Watt — test notification',
    body: 'Push is working. Alerts for slab jumps, outages, and spikes will arrive like this.',
    url: '/',
    tag: 'test'
  })
  return { success: true as const, data: result, error: null }
})
