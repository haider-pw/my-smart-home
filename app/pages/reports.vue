<script setup lang="ts">
interface ApiEnvelope<T> {
  success: boolean
  data: T | null
  error: string | null
}

interface TrendData {
  bucket: 'day' | 'hour'
  points: Array<{ day?: string, hourStart?: number, kwh: number }>
}

interface CompareData {
  current: { cycle: { daysElapsed: number, daysTotal: number }, units: number, costPkr: number }
  previous: { unitsSamePace: number, unitsFull: number, costFullPkr: number }
  deltaPct: number | null
}

interface VoltageData {
  points: Array<{ ts: number, v: number | null, hz: number | null }>
  excursions: Array<{ ts: number, v: number | null }>
  stats: { minV: number, maxV: number, avgV: number, samples: number, healthyBand: [number, number] } | null
}

interface DeviceRow {
  id: string
  name: string
  role: string
}

useSeoMeta({ title: 'Reports — Electricity Analytics' })

const route = useRoute()
const router = useRouter()

// URL-persisted filters (shareable)
const days = ref(Number(route.query.days) || 30)
const device = ref<string>(typeof route.query.device === 'string' ? route.query.device : '')
watch([days, device], () => {
  router.replace({ query: { days: days.value, ...(device.value ? { device: device.value } : {}) } })
})

const { data: devicesRes } = await useFetch<ApiEnvelope<{ devices: DeviceRow[] }>>('/api/reports/summary', {
  lazy: true,
  retry: 2,
  retryDelay: 1500,
  transform: (r: ApiEnvelope<{ devices: DeviceRow[] }>) => r
})

const deviceOptions = computed(() => [
  { label: 'Whole house (breaker)', value: '' },
  ...(devicesRes.value?.data?.devices ?? [])
    .filter(d => d.role === 'plug')
    .map(d => ({ label: d.name, value: d.id }))
])

const { data: trendRes, pending: trendPending } = await useFetch<ApiEnvelope<TrendData>>('/api/reports/trend', {
  query: computed(() => ({ bucket: 'day', days: days.value, ...(device.value ? { device: device.value } : {}) })),
  lazy: true,
  watch: [days, device],
  retry: 2,
  retryDelay: 1500
})

const { data: compareRes } = await useFetch<ApiEnvelope<CompareData>>('/api/reports/compare', { lazy: true, retry: 2, retryDelay: 1500 })
const { data: voltageRes } = await useFetch<ApiEnvelope<VoltageData>>('/api/reports/voltage', {
  query: computed(() => ({ days: Math.min(days.value, 30) })),
  lazy: true,
  watch: [days],
  retry: 2,
  retryDelay: 1500
})

const trendPoints = computed(() =>
  (trendRes.value?.data?.points ?? []).map(p => ({ label: (p.day ?? '').slice(5), kwh: p.kwh }))
)

const compare = computed(() => compareRes.value?.data ?? null)
const voltage = computed(() => voltageRes.value?.data ?? null)

const voltageOption = computed(() => {
  const pts = voltage.value?.points ?? []
  const band = voltage.value?.stats?.healthyBand ?? [210, 250]
  return {
    grid: { left: 44, right: 12, top: 16, bottom: 40 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#0b111a',
      borderColor: 'rgba(255,255,255,.1)',
      textStyle: { color: '#e7eef5', fontFamily: 'IBM Plex Mono', fontSize: 12 },
      valueFormatter: (v: number) => `${v} V`
    },
    dataZoom: [{ type: 'inside' }, { type: 'slider', height: 16, bottom: 6, borderColor: 'rgba(255,255,255,.1)' }],
    xAxis: {
      type: 'time',
      axisLabel: { color: '#5b6a7c', fontFamily: 'IBM Plex Mono', fontSize: 9, hideOverlap: true },
      axisLine: { lineStyle: { color: 'rgba(255,255,255,.12)' } }
    },
    yAxis: {
      type: 'value',
      min: (v: { min: number }) => Math.floor(Math.min(v.min, band[0]!) - 5),
      max: (v: { max: number }) => Math.ceil(Math.max(v.max, band[1]!) + 5),
      splitLine: { lineStyle: { color: 'rgba(255,255,255,.05)' } },
      axisLabel: { color: '#5b6a7c', fontFamily: 'IBM Plex Mono', fontSize: 9 }
    },
    series: [{
      type: 'line',
      showSymbol: false,
      data: pts.map(p => [p.ts + 5 * 3600 * 1000, p.v]),
      lineStyle: { color: '#4ad4ff', width: 1.4 },
      markArea: {
        silent: true,
        itemStyle: { color: 'rgba(52,232,164,.05)' },
        data: [[{ yAxis: band[0] }, { yAxis: band[1] }]]
      }
    }]
  }
})

const fmt = (n: number) => Math.round(n).toLocaleString('en-IN')
const fmt1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString('en-IN')
</script>

<template>
  <UContainer class="py-6 space-y-4">
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <div>
        <h1 class="text-sm font-semibold flex items-center gap-2">
          <UIcon
            name="i-lucide-file-bar-chart"
            class="size-4 text-primary"
          />
          Reports
        </h1>
        <p class="microlabel text-dimmed mt-1">
          Filterable history · shareable URLs · CSV export
        </p>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <USelect
          v-model="device"
          :items="deviceOptions"
          size="sm"
          class="w-52"
        />
        <div class="flex rounded-lg bg-elevated/70 p-0.5 gap-0.5">
          <UButton
            v-for="d in [7, 14, 30, 90]"
            :key="d"
            size="xs"
            :variant="days === d ? 'soft' : 'ghost'"
            :color="days === d ? 'primary' : 'neutral'"
            :label="`${d}d`"
            @click="days = d"
          />
        </div>
        <UButton
          size="xs"
          variant="ghost"
          color="neutral"
          icon="i-lucide-download"
          label="CSV"
          :to="`/api/export/csv?dataset=hourly&days=${days}`"
          external
        />
      </div>
    </div>

    <!-- Cycle comparison -->
    <div
      v-if="compare"
      class="grid sm:grid-cols-3 gap-3"
    >
      <div class="panel p-4">
        <p class="microlabel text-dimmed">
          This cycle (day {{ compare.current.cycle.daysElapsed }})
        </p>
        <p class="num text-2xl font-bold mt-2 text-[#4ad4ff]">
          {{ fmt1(compare.current.units) }} <span class="text-sm text-muted">kWh</span>
        </p>
        <p class="text-xs text-muted mt-1">
          ≈ Rs {{ fmt(compare.current.costPkr) }}
        </p>
      </div>
      <div class="panel p-4">
        <p class="microlabel text-dimmed">
          Last cycle, same pace
        </p>
        <p class="num text-2xl font-bold mt-2">
          {{ fmt1(compare.previous.unitsSamePace) }} <span class="text-sm text-muted">kWh</span>
        </p>
        <p
          v-if="compare.deltaPct !== null"
          class="text-xs mt-1"
          :class="compare.deltaPct > 0 ? 'text-[#ffbc57]' : 'text-[#34e8a4]'"
        >
          {{ compare.deltaPct > 0 ? '▲' : '▼' }} {{ Math.abs(compare.deltaPct) }}% vs last cycle
        </p>
      </div>
      <div class="panel p-4">
        <p class="microlabel text-dimmed">
          Last cycle, full
        </p>
        <p class="num text-2xl font-bold mt-2">
          {{ fmt1(compare.previous.unitsFull) }} <span class="text-sm text-muted">kWh</span>
        </p>
        <p class="text-xs text-muted mt-1">
          ≈ Rs {{ fmt(compare.previous.costFullPkr) }}
        </p>
      </div>
    </div>

    <!-- Consumption trend -->
    <div class="panel p-5">
      <div class="flex items-center justify-between mb-2">
        <h2 class="text-sm font-semibold">
          Daily consumption — {{ device ? deviceOptions.find(o => o.value === device)?.label : 'whole house' }}
        </h2>
        <span
          v-if="trendPending"
          class="microlabel text-dimmed"
        >loading…</span>
      </div>
      <DashboardTrendChart :points="trendPoints" />
    </div>

    <!-- Voltage / electrical health -->
    <div class="panel p-5">
      <div class="flex items-center justify-between mb-2 flex-wrap gap-2">
        <h2 class="text-sm font-semibold">
          Voltage history — electrical health
        </h2>
        <div
          v-if="voltage?.stats"
          class="flex gap-4 microlabel text-dimmed"
        >
          <span>min <b class="num text-default">{{ voltage.stats.minV }}V</b></span>
          <span>avg <b class="num text-default">{{ voltage.stats.avgV }}V</b></span>
          <span>max <b class="num text-default">{{ voltage.stats.maxV }}V</b></span>
          <span
            v-if="voltage.excursions.length > 0"
            class="text-[#ff6376]"
          >{{ voltage.excursions.length }} excursions outside 210–250V</span>
        </div>
      </div>
      <ClientOnly>
        <VChart
          v-if="(voltage?.points.length ?? 0) > 1"
          :option="voltageOption"
          :autoresize="true"
          class="w-full"
          :style="{ height: '220px', width: '100%' }"
        />
        <p
          v-else
          class="text-sm text-muted text-center py-8"
        >
          Voltage samples accumulate from the 5-minute poller — check back soon.
        </p>
        <template #fallback>
          <div style="height: 220px" />
        </template>
      </ClientOnly>
    </div>
  </UContainer>
</template>
