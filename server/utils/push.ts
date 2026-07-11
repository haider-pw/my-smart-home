/**
 * Web Push delivery over the stored subscriptions. Dead endpoints
 * (410/404) are pruned automatically.
 */
import webpush from 'web-push'
import { eq } from 'drizzle-orm'
import * as schema from '../db/schema'
import type { Db } from './db'

export interface PushPayload {
  title: string
  body: string
  url?: string
  tag?: string
}

function configured(): boolean {
  const config = useRuntimeConfig()
  return Boolean(config.public.vapidPublicKey && config.vapid.privateKey)
}

export async function sendPushToAll(db: Db, payload: PushPayload): Promise<{ sent: number, pruned: number }> {
  if (!configured()) {
    return { sent: 0, pruned: 0 }
  }
  const config = useRuntimeConfig()
  webpush.setVapidDetails(
    config.vapid.subject || 'mailto:owner@example.com',
    config.public.vapidPublicKey,
    config.vapid.privateKey
  )

  const subs = await db.select().from(schema.pushSubscriptions).all()
  let sent = 0
  let pruned = 0
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys as { p256dh: string, auth: string } },
        JSON.stringify(payload),
        { TTL: 3600 }
      )
      sent++
    } catch (error: unknown) {
      const status = (error as { statusCode?: number }).statusCode
      if (status === 404 || status === 410) {
        await db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.id, sub.id))
        pruned++
      }
    }
  }
  return { sent, pruned }
}
