<script setup lang="ts">
const props = defineProps<{
  cells: Array<{ day: string, hour: number, kwh: number }>
  peakHours: [number, number]
}>()

const days = computed(() => Array.from(new Set(props.cells.map(c => c.day))).sort())

const option = computed(() => {
  const dayIndex = new Map(days.value.map((d, i) => [d, i]))
  const maxKwh = Math.max(...props.cells.map(c => c.kwh), 0.1)
  const hourLabel = (h: number) => (h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`)

  return {
    grid: { left: 56, right: 12, top: 26, bottom: 26 },
    tooltip: {
      backgroundColor: '#0b111a',
      borderColor: 'rgba(255,255,255,.1)',
      textStyle: { color: '#e7eef5', fontFamily: 'IBM Plex Mono', fontSize: 12 },
      formatter: (p: { value: [number, number, number] }) =>
        `${days.value[p.value[1]]} · ${hourLabel(p.value[0])}<br/>${(Math.round(p.value[2] * 100) / 100).toLocaleString()} kWh`
    },
    xAxis: {
      type: 'category',
      data: Array.from({ length: 24 }, (_, h) => hourLabel(h)),
      splitArea: { show: false },
      axisLabel: { color: '#5b6a7c', fontFamily: 'IBM Plex Mono', fontSize: 9, interval: 2 },
      axisLine: { show: false },
      axisTick: { show: false }
    },
    yAxis: {
      type: 'category',
      data: days.value.map(d => d.slice(5)),
      axisLabel: { color: '#5b6a7c', fontFamily: 'IBM Plex Mono', fontSize: 9 },
      axisLine: { show: false },
      axisTick: { show: false }
    },
    visualMap: {
      show: false,
      min: 0,
      max: maxKwh,
      inRange: { color: ['rgba(74,212,255,.07)', 'rgba(74,212,255,.45)', 'rgba(169,139,255,.95)'] }
    },
    series: [{
      type: 'heatmap',
      data: props.cells.map(c => [c.hour, dayIndex.get(c.day) ?? 0, Math.round(c.kwh * 100) / 100]),
      itemStyle: { borderColor: '#0b1017', borderWidth: 1.5, borderRadius: 3 },
      emphasis: { itemStyle: { shadowBlur: 8, shadowColor: 'rgba(74,212,255,.5)' } },
      markArea: {
        silent: true,
        itemStyle: { color: 'transparent', borderColor: 'rgba(169,139,255,.55)', borderWidth: 1.2 },
        label: {
          show: true,
          formatter: 'PEAK',
          position: 'top',
          color: '#a98bff',
          fontFamily: 'IBM Plex Mono',
          fontSize: 9
        },
        data: [[{ xAxis: props.peakHours[0] }, { xAxis: props.peakHours[1] - 1 }]]
      }
    }]
  }
})
</script>

<template>
  <ClientOnly>
    <VChart
      :option="option"
      :autoresize="true"
      class="w-full"
      :style="{ height: `${Math.max(days.length * 26 + 60, 160)}px` }"
    />
    <template #fallback>
      <div class="h-40" />
    </template>
  </ClientOnly>
</template>
