<script setup lang="ts">
const props = defineProps<{
  points: Array<{ label: string, kwh: number }>
  paceKwhPerDay?: number
  unitLabel?: string
}>()

const option = computed(() => {
  const pace = props.paceKwhPerDay
  return {
    grid: { left: 42, right: 12, top: 24, bottom: 28 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#0b111a',
      borderColor: 'rgba(255,255,255,.1)',
      textStyle: { color: '#e7eef5', fontFamily: 'IBM Plex Mono', fontSize: 12 },
      valueFormatter: (v: number) => `${(Math.round(v * 10) / 10).toLocaleString()} kWh`
    },
    xAxis: {
      type: 'category',
      data: props.points.map(p => p.label),
      axisLine: { lineStyle: { color: 'rgba(255,255,255,.15)' } },
      axisLabel: { color: '#5b6a7c', fontFamily: 'IBM Plex Mono', fontSize: 10 },
      axisTick: { show: false }
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: 'rgba(255,255,255,.05)' } },
      axisLabel: { color: '#5b6a7c', fontFamily: 'IBM Plex Mono', fontSize: 10 }
    },
    series: [{
      type: 'bar',
      data: props.points.map(p => ({
        value: Math.round(p.kwh * 100) / 100,
        itemStyle: {
          color: pace !== undefined && p.kwh > pace ? 'rgba(255,188,87,.75)' : 'rgba(52,232,164,.7)',
          borderRadius: [4, 4, 0, 0]
        }
      })),
      barMaxWidth: 26,
      ...(pace !== undefined
        ? {
            markLine: {
              silent: true,
              symbol: 'none',
              lineStyle: { color: '#34e8a4', type: 'dashed', width: 1.2, opacity: 0.8 },
              label: {
                formatter: `PACE ${Math.round(pace * 10) / 10} kWh/d`,
                color: '#34e8a4',
                fontFamily: 'IBM Plex Mono',
                fontSize: 10,
                position: 'insideEndTop'
              },
              data: [{ yAxis: pace }]
            }
          }
        : {})
    }]
  }
})
</script>

<template>
  <ClientOnly>
    <VChart
      :option="option"
      :autoresize="true"
      class="h-56 w-full"
    />
    <template #fallback>
      <div class="h-56" />
    </template>
  </ClientOnly>
</template>
