import { eq } from 'drizzle-orm'
import * as schema from '../../db/schema'
import { useDb } from '../../utils/db'

/** POST /api/push/unsubscribe — remove this browser's subscription. */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ endpoint?: string }>(event)
  if (!body?.endpoint) {
    setResponseStatus(event, 400)
    return { success: false as const, data: null, error: 'endpoint required' }
  }
  const db = useDb()
  await db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.endpoint, body.endpoint))
  return { success: true as const, data: { subscribed: false }, error: null }
})
