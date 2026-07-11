<script setup lang="ts">
defineProps<{
  kpis: Array<{
    label: string
    value: string
    unit?: string
    sub?: string
    tone?: 'default' | 'green' | 'amber' | 'red' | 'cyan'
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
    <div
      v-for="kpi in kpis"
      :key="kpi.label"
      class="panel p-4"
    >
      <p class="microlabel text-dimmed">
        {{ kpi.label }}
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
    </div>
  </div>
</template>
