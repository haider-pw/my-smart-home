<script setup lang="ts">
/**
 * Subtle install hint. Listens for beforeinstallprompt (Android/Chrome) and
 * shows an iOS-specific tip since Safari has no programmatic install.
 * Dismissal is remembered in localStorage.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'watt-install-dismissed'
const deferredPrompt = ref<BeforeInstallPromptEvent | null>(null)
const show = ref(false)
const isIos = ref(false)

onMounted(() => {
  if (localStorage.getItem(DISMISS_KEY) === '1') {
    return
  }
  // Already installed?
  if (window.matchMedia('(display-mode: standalone)').matches) {
    return
  }
  const ua = window.navigator.userAgent
  isIos.value = /iphone|ipad|ipod/i.test(ua) && !/crios|fxios/i.test(ua)

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt.value = e as BeforeInstallPromptEvent
    show.value = true
  })

  // iOS gets a manual tip after a short delay (no install event exists there)
  if (isIos.value) {
    setTimeout(() => {
      show.value = true
    }, 2500)
  }
})

async function install() {
  if (!deferredPrompt.value) {
    return
  }
  await deferredPrompt.value.prompt()
  await deferredPrompt.value.userChoice
  deferredPrompt.value = null
  dismiss()
}

function dismiss() {
  show.value = false
  localStorage.setItem(DISMISS_KEY, '1')
}
</script>

<template>
  <Transition
    enter-active-class="transition duration-300"
    enter-from-class="translate-y-4 opacity-0"
    leave-active-class="transition duration-200"
    leave-to-class="translate-y-4 opacity-0"
  >
    <div
      v-if="show"
      class="lg:hidden fixed inset-x-3 z-50 rounded-2xl border border-primary/30 bg-elevated/95 backdrop-blur-lg p-4 shadow-xl"
      style="bottom: calc(env(safe-area-inset-bottom) + 72px)"
    >
      <div class="flex items-start gap-3">
        <span class="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 ring-1 ring-primary/30">
          <UIcon
            name="i-lucide-download"
            class="size-4 text-primary"
          />
        </span>
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold">
            Install Watt
          </p>
          <p
            v-if="isIos"
            class="text-xs text-muted mt-0.5"
          >
            Tap <UIcon
              name="i-lucide-share"
              class="size-3 inline align-text-bottom"
            /> then “Add to Home Screen” for the full-screen app.
          </p>
          <p
            v-else
            class="text-xs text-muted mt-0.5"
          >
            Add to your home screen for a full-screen, app-like experience.
          </p>
          <div class="flex gap-2 mt-2.5">
            <UButton
              v-if="!isIos"
              size="xs"
              label="Install"
              icon="i-lucide-plus"
              @click="install"
            />
            <UButton
              size="xs"
              variant="ghost"
              color="neutral"
              label="Not now"
              @click="dismiss"
            />
          </div>
        </div>
        <UButton
          size="xs"
          variant="ghost"
          color="neutral"
          icon="i-lucide-x"
          aria-label="Dismiss"
          @click="dismiss"
        />
      </div>
    </div>
  </Transition>
</template>
