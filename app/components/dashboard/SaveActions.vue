<script setup lang="ts">
interface Recommendation {
  rank: number
  head: string
  detail: string
  save: string
  severity: 'high' | 'medium' | 'info'
}

defineProps<{ recommendations: Recommendation[] }>()
</script>

<template>
  <div class="flex flex-col gap-2.5">
    <div
      v-for="rec in recommendations"
      :key="rec.rank"
      class="flex gap-3 rounded-xl border p-3 items-start"
      :class="rec.severity === 'high'
        ? 'border-[#ff6376]/40 bg-gradient-to-r from-[#ff6376]/10 to-transparent'
        : 'border-default/60 bg-elevated/40'"
    >
      <span
        class="grid size-6 shrink-0 place-items-center rounded-lg font-mono text-xs font-bold mt-0.5"
        :class="rec.severity === 'high' ? 'bg-[#ff6376] text-black shadow-[0_0_14px_rgba(255,99,118,.45)]' : 'bg-elevated text-muted'"
      >
        {{ rec.rank }}
      </span>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold leading-snug">
          {{ rec.head }}
        </p>
        <p class="text-xs text-muted mt-0.5 leading-relaxed">
          {{ rec.detail }}
        </p>
      </div>
      <span
        class="num text-xs font-bold whitespace-nowrap mt-0.5"
        :class="rec.severity === 'high' ? 'text-[#ff6376]' : rec.severity === 'medium' ? 'text-[#ffbc57]' : 'text-[#4ad4ff]'"
      >
        {{ rec.save }}
      </span>
    </div>
    <p
      v-if="recommendations.length === 0"
      class="text-sm text-muted py-4 text-center"
    >
      Not enough history yet — recommendations appear after a few days of data.
    </p>
  </div>
</template>
