<script setup lang="ts">
import { NuxtLink } from '#components'

defineProps<{
  kpis: Array<{
    label: string
    value: string
    unit?: string
    sub?: string
    tone?: 'default' | 'green' | 'amber' | 'red' | 'cyan'
    /** When set, the card becomes a link (drill-down affordance) */
    to?: string
  }>
}>()

const toneClass: Record<string, string> = {
  default: '',
  green: 'text-[#34e8a4]',
  amber: 'text-[#ffbc57]',
  red: 'text-[#ff6376]',
  cyan: 'text-[#4ad4ff]'
}
</script>

<template>
  <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
    <component
      :is="kpi.to ? NuxtLink : 'div'"
      v-for="kpi in kpis"
      :key="kpi.label"
      :to="kpi.to"
      class="panel p-4 block"
      :class="kpi.to ? 'transition hover:ring-2 hover:ring-primary/40 cursor-pointer' : ''"
    >
      <p class="microlabel text-dimmed flex items-center justify-between">
        {{ kpi.label }}
        <UIcon
          v-if="kpi.to"
          name="i-lucide-chevron-right"
          class="size-3 text-dimmed"
        />
      </p>
      <p
        class="num text-xl sm:text-2xl font-bold mt-2 leading-none"
        :class="toneClass[kpi.tone ?? 'default']"
      >
        {{ kpi.value }}
        <span
          v-if="kpi.unit"
          class="text-sm text-muted font-medium"
        >{{ kpi.unit }}</span>
      </p>
      <p
        v-if="kpi.sub"
        class="text-xs text-muted mt-1.5"
      >
        {{ kpi.sub }}
      </p>
    </component>
  </div>
</template>
