import * as schema from '../../db/schema'
import { useDb } from '../../utils/db'

/** POST /api/push/subscribe — store this browser's push subscription. */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ endpoint?: string, keys?: { p256dh?: string, auth?: string } }>(event)
  if (!body?.endpoint || !body.keys?.p256dh || !body.keys.auth) {
    setResponseStatus(event, 400)
    return { success: false as const, data: null, error: 'PushSubscription JSON required' }
  }
  const db = useDb()
  await db.insert(schema.pushSubscriptions)
    .values({ endpoint: body.endpoint, keys: { p256dh: body.keys.p256dh, auth: body.keys.auth }, createdAt: Date.now() })
    .onConflictDoUpdate({
      target: schema.pushSubscriptions.endpoint,
      set: { keys: { p256dh: body.keys.p256dh, auth: body.keys.auth } }
    })
  return { success: true as const, data: { subscribed: true }, error: null }
})
