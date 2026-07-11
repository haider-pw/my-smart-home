<script setup lang="ts">
const props = defineProps<{
  projectedPkr: number
  cycleSoFarPkr: number
  projectedUnits: number
  budgetGreen: number
  budgetRed: number
  budgetStatus: 'green' | 'amber' | 'red'
  cycleLabel: string
}>()

const statusColor = computed(() =>
  props.budgetStatus === 'green' ? '#34e8a4' : props.budgetStatus === 'amber' ? '#ffbc57' : '#ff6376'
)

const gaugeMax = computed(() =>
  Math.max(props.budgetRed * 1.35, Math.ceil(props.projectedPkr / 5000) * 5000 + 5000)
)

const option = computed(() => ({
  series: [{
    type: 'gauge',
    startAngle: 200,
    endAngle: -20,
    min: 0,
    max: gaugeMax.value,
    radius: '100%',
    center: ['50%', '62%'],
    pointer: { show: false },
    progress: {
      show: true,
      width: 14,
      roundCap: true,
      itemStyle: { color: statusColor.value, shadowBlur: 14, shadowColor: statusColor.value }
    },
    axisLine: {
      lineStyle: {
        width: 14,
        color: [
          [props.budgetGreen / gaugeMax.value, 'rgba(52,232,164,.14)'],
          [props.budgetRed / gaugeMax.value, 'rgba(255,188,87,.14)'],
          [1, 'rgba(255,99,118,.14)']
        ]
      }
    },
    axisTick: { show: false },
    splitLine: { show: false },
    axisLabel: { show: false },
    anchor: { show: false },
    title: { show: false },
    detail: { show: false },
    data: [{ value: Math.min(props.projectedPkr, gaugeMax.value) }]
  }]
}))

const fmt = (n: number) => Math.round(n).toLocaleString('en-IN')
</script>

<template>
  <div class="relative">
    <ClientOnly>
      <!-- vue-echarts sets inline height:100% — explicit style wins over classes -->
      <VChart
        :option="option"
        :autoresize="true"
        class="w-full"
        :style="{ height: '176px', width: '100%' }"
      />
      <template #fallback>
        <div style="height: 176px" />
      </template>
    </ClientOnly>
    <div class="absolute inset-x-0 bottom-1 text-center pointer-events-none">
      <p class="microlabel text-dimmed">
        Projected · {{ cycleLabel }}
      </p>
      <p
        class="num font-bold text-3xl sm:text-4xl mt-1"
        :style="{ color: statusColor }"
      >
        <span class="text-sm text-muted font-semibold mr-1">PKR</span>{{ fmt(projectedPkr) }}
      </p>
      <p class="num text-xs text-muted mt-1">
        Rs {{ fmt(cycleSoFarPkr) }} so far · {{ fmt(projectedUnits) }} units projected
      </p>
    </div>
  </div>
</template>
