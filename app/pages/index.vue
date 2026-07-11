<script setup lang="ts">
useSeoMeta({
  title: 'Dashboard — Electricity Analytics'
})
</script>

<template>
  <UContainer class="py-16">
    <UCard>
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon
            name="i-lucide-layout-dashboard"
            class="size-5 text-primary"
          />
          <h1 class="font-semibold">
            Dashboard
          </h1>
        </div>
      </template>

      <p class="text-muted">
        The full analytics dashboard (projected bill, slab ladder, savings recommendations)
        arrives in Phase 4. Right now, Phase 0 is about confirming what data your devices
        actually expose.
      </p>

      <template #footer>
        <UButton
          to="/explorer"
          icon="i-lucide-search-code"
          label="Open Device Explorer"
        />
      </template>
    </UCard>
  </UContainer>
</template>
