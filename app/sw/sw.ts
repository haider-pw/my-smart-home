/// <reference lib="webworker" />
/**
 * Service worker: precache app shell (workbox, injected manifest) + Web Push.
 */
import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'

declare let self: ServiceWorkerGlobalScope

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)
self.skipWaiting()
clientsClaim()

interface PushPayload {
  title?: string
  body?: string
  url?: string
  tag?: string
}

self.addEventListener('push', (event) => {
  let payload: PushPayload
  try {
    payload = event.data?.json() ?? {}
  } catch {
    payload = { body: event.data?.text() ?? '' }
  }
  event.waitUntil(self.registration.showNotification(payload.title ?? '⚡ Watt', {
    body: payload.body ?? '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: payload.tag,
    data: { url: payload.url ?? '/' }
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data as { url?: string })?.url ?? '/'
  event.waitUntil(self.clients.openWindow(url))
})
