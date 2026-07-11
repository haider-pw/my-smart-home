<script setup lang="ts">
const props = defineProps<{
  green: number
  red: number
  status: 'green' | 'amber' | 'red'
}>()

const k = (n: number) => `${Math.round(n / 1000)}k`

const chips = computed(() => [
  { key: 'green', label: 'On target', value: `≤ ${k(props.green)}`, color: 'text-[#34e8a4]' },
  { key: 'amber', label: 'Watch', value: `${k(props.green)}–${k(props.red)}`, color: 'text-[#ffbc57]' },
  { key: 'red', label: 'Over budget', value: `> ${k(props.red)}`, color: 'text-[#ff6376]' }
])
</script>

<template>
  <div class="flex gap-2 mt-3">
    <div
      v-for="chip in chips"
      :key="chip.key"
      class="flex-1 text-center rounded-xl border py-2 px-1 transition"
      :class="status === chip.key
        ? 'border-white/20 bg-white/5 shadow-[inset_0_0_14px_rgba(255,255,255,.04)]'
        : 'border-default/60 opacity-60'"
    >
      <p
        class="num text-sm font-semibold"
        :class="chip.color"
      >
        {{ chip.value }}
      </p>
      <p class="microlabel text-dimmed mt-0.5 !text-[9px]">
        {{ chip.label }}
      </p>
    </div>
  </div>
</template>
