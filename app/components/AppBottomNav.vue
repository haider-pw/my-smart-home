<script setup lang="ts">
/**
 * Thumb-friendly bottom tab bar — the primary navigation on phones (hidden
 * on lg+, where the header nav takes over). Safe-area padding keeps it clear
 * of the home indicator on notched devices.
 */
const route = useRoute()

const tabs = [
  { label: 'Home', to: '/', icon: 'i-lucide-layout-dashboard' },
  { label: 'Live', to: '/live', icon: 'i-lucide-activity' },
  { label: 'Reports', to: '/reports', icon: 'i-lucide-file-bar-chart' },
  { label: 'Outages', to: '/outages', icon: 'i-lucide-zap-off' },
  { label: 'Settings', to: '/settings', icon: 'i-lucide-settings-2' }
]

function isActive(to: string): boolean {
  return to === '/' ? route.path === '/' : route.path.startsWith(to)
}
</script>

<template>
  <nav
    class="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-default bg-default/90 backdrop-blur-lg"
    style="padding-bottom: env(safe-area-inset-bottom)"
    aria-label="Primary"
  >
    <div class="grid grid-cols-5">
      <NuxtLink
        v-for="tab in tabs"
        :key="tab.to"
        :to="tab.to"
        class="flex flex-col items-center justify-center gap-1 py-2.5 min-h-[56px] transition-colors"
        :class="isActive(tab.to) ? 'text-primary' : 'text-dimmed active:text-muted'"
      >
        <UIcon
          :name="tab.icon"
          class="size-5"
        />
        <span class="text-[10px] font-medium leading-none">{{ tab.label }}</span>
      </NuxtLink>
    </div>
  </nav>
</template>
