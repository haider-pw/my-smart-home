<script setup lang="ts">
const props = defineProps<{
  values: number[]
  color: string
  height?: number
}>()

const option = computed(() => ({
  grid: { left: 0, right: 0, top: 4, bottom: 2 },
  xAxis: { type: 'category', show: false, data: props.values.map((_, i) => i) },
  yAxis: { type: 'value', show: false, min: 0 },
  series: [{
    type: 'line',
    data: props.values.map(v => Math.round(v)),
    symbol: 'none',
    lineStyle: { color: props.color, width: 1.8 },
    areaStyle: { color: props.color, opacity: 0.08 },
    animation: false
  }]
}))
</script>

<template>
  <ClientOnly>
    <VChart
      :option="option"
      :autoresize="true"
      class="w-full"
      :style="{ height: `${height ?? 44}px`, width: '100%' }"
    />
    <template #fallback>
      <div :style="{ height: `${height ?? 44}px` }" />
    </template>
  </ClientOnly>
</template>
