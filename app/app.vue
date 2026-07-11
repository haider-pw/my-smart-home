<script setup lang="ts">
useHead({
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1' }
  ],
  link: [
    { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
    { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/icon-32.png' },
    { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
    { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
    { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
    {
      rel: 'stylesheet',
      href: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap'
    }
  ],
  htmlAttrs: {
    lang: 'en'
  }
})

const title = 'Electricity Analytics'
const description = 'Personal smart-home electricity analytics — IESCO · Islamabad'

useSeoMeta({
  title,
  description,
  robots: 'noindex, nofollow'
})

const links = [
  { label: 'Dashboard', to: '/', icon: 'i-lucide-layout-dashboard' },
  { label: 'Live', to: '/live', icon: 'i-lucide-activity' },
  { label: 'Reports', to: '/reports', icon: 'i-lucide-file-bar-chart' },
  { label: 'Outages', to: '/outages', icon: 'i-lucide-zap-off' },
  { label: 'Explorer', to: '/explorer', icon: 'i-lucide-search-code' },
  { label: 'Settings', to: '/settings', icon: 'i-lucide-settings-2' }
]
</script>

<template>
  <UApp>
    <UHeader>
      <template #left>
        <NuxtLink
          to="/"
          class="flex items-center gap-2.5"
        >
          <span class="grid size-9 place-items-center rounded-xl bg-primary/10 ring-1 ring-primary/30 shadow-[0_0_20px_rgba(74,212,255,.15)]">
            <UIcon
              name="i-lucide-zap"
              class="size-4 text-primary"
            />
          </span>
          <span class="leading-tight">
            <span class="block font-bold">Electricity Analytics</span>
            <span class="microlabel text-dimmed !text-[9px] hidden sm:block">IESCO · Islamabad · load monitor</span>
          </span>
        </NuxtLink>
      </template>

      <UNavigationMenu :items="links" />
    </UHeader>

    <UMain>
      <NuxtPage />
    </UMain>
  </UApp>
</template>
