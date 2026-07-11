<script setup lang="ts">
useHead({
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1' }
  ],
  link: [
    { rel: 'icon', href: '/favicon.ico' },
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
  { label: 'Explorer', to: '/explorer', icon: 'i-lucide-search-code' }
]
</script>

<template>
  <UApp>
    <UHeader>
      <template #left>
        <NuxtLink
          to="/"
          class="flex items-center gap-2 font-bold"
        >
          <UIcon
            name="i-lucide-zap"
            class="size-5 text-primary"
          />
          <span>Electricity Analytics</span>
        </NuxtLink>
      </template>

      <UNavigationMenu :items="links" />

      <template #right>
        <UBadge
          variant="subtle"
          size="sm"
        >
          Phase 0
        </UBadge>
      </template>
    </UHeader>

    <UMain>
      <NuxtPage />
    </UMain>
  </UApp>
</template>
