<script setup lang="ts">
const props = defineProps<{
  slices: Array<{ name: string, kwh: number, costPkr: number, color: string }>
  totalPkr: number
}>()

const option = computed(() => ({
  tooltip: {
    trigger: 'item',
    backgroundColor: '#0b111a',
    borderColor: 'rgba(255,255,255,.1)',
    textStyle: { color: '#e7eef5', fontFamily: 'IBM Plex Mono', fontSize: 12 },
    formatter: (params: { name: string, value: number, percent: number }) =>
      `${params.name}<br/>Rs ${Math.round(params.value).toLocaleString('en-IN')} · ${params.percent}%`
  },
  series: [{
    type: 'pie',
    radius: ['64%', '88%'],
    itemStyle: { borderColor: '#0b1017', borderWidth: 3 },
    label: { show: false },
    data: props.slices.map(s => ({
      name: s.name,
      value: Math.round(s.costPkr),
      itemStyle: { color: s.color, opacity: 0.88 }
    }))
  }]
}))

const fmt = (n: number) => Math.round(n).toLocaleString('en-IN')
</script>

<template>
  <div>
    <div class="relative">
      <ClientOnly>
        <!-- vue-echarts sets inline height:100% — explicit style wins over classes -->
        <VChart
          :option="option"
          :autoresize="true"
          class="w-full"
          :style="{ height: '192px', width: '100%' }"
        />
        <template #fallback>
          <div style="height: 192px" />
        </template>
      </ClientOnly>
      <div class="absolute inset-0 grid place-items-center pointer-events-none text-center">
        <div class="max-w-24">
          <p class="microlabel text-dimmed !text-[9px]">
            so far
          </p>
          <p class="num text-lg font-bold mt-0.5">
            {{ fmt(totalPkr) }}
          </p>
          <p class="text-[10px] text-muted">
            PKR
          </p>
        </div>
      </div>
    </div>
    <div class="flex flex-col gap-1.5 mt-3">
      <div
        v-for="slice in slices"
        :key="slice.name"
        class="flex items-center gap-2.5 text-xs"
      >
        <span
          class="size-2.5 rounded shrink-0"
          :style="{ background: slice.color, boxShadow: `0 0 8px ${slice.color}` }"
        />
        <span class="flex-1 text-muted truncate">{{ slice.name }}</span>
        <span class="num text-dimmed">{{ (Math.round(slice.kwh * 10) / 10).toLocaleString() }} kWh</span>
        <span class="num font-semibold min-w-16 text-right">Rs {{ fmt(slice.costPkr) }}</span>
      </div>
    </div>
  </div>
</template>
