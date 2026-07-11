/** Web Push subscribe/unsubscribe for this browser. */
export function usePush() {
  const config = useRuntimeConfig()
  const supported = ref(false)
  const subscribed = ref(false)
  const busy = ref(false)

  async function refresh() {
    if (!import.meta.client || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      supported.value = false
      return
    }
    supported.value = Boolean(config.public.vapidPublicKey)
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = await reg?.pushManager.getSubscription()
    subscribed.value = Boolean(sub)
  }

  function base64ToUint8(base64: string): Uint8Array {
    const padding = '='.repeat((4 - (base64.length % 4)) % 4)
    const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
    return Uint8Array.from(raw, c => c.charCodeAt(0))
  }

  async function subscribe(): Promise<boolean> {
    busy.value = true
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        return false
      }
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64ToUint8(config.public.vapidPublicKey) as unknown as ArrayBuffer
      })
      await $fetch('/api/push/subscribe', { method: 'POST', body: sub.toJSON() })
      subscribed.value = true
      return true
    } finally {
      busy.value = false
    }
  }

  async function unsubscribe(): Promise<void> {
    busy.value = true
    try {
      const reg = await navigator.serviceWorker.getRegistration()
      const sub = await reg?.pushManager.getSubscription()
      if (sub) {
        await $fetch('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } })
        await sub.unsubscribe()
      }
      subscribed.value = false
    } finally {
      busy.value = false
    }
  }

  return { supported, subscribed, busy, refresh, subscribe, unsubscribe }
}
