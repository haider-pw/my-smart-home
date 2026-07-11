<script setup lang="ts">
import { BASELINE_COLOR, deviceColor, formatDayLong, formatDayShort } from '~/utils/format'

interface ApiEnvelope<T> {
  success: boolean
  data: T | null
  error: string | null
}

interface CostDevice {
  id: string
  name: string
  role: 'plug' | 'baseline'
  kwh: number
  costPkr: number
  todayKwh: number
  todayCostPkr: number
  avgPerDayKwh: number
  sharePct: number
  projectedCyclePkr: number | null
}

interface CostData {
  range: string
  ratePkrPerUnit: number
  rateSource: 'bill' | 'slab-model'
  cycle: { startTs: number, endTs: number, daysElapsed: number, daysTotal: number, todayKey: string }
  totals: { kwh: number, costPkr: number }
  days: Array<{ day: string, partial: boolean, totalKwh: number, totalPkr: number, perDevicePkr: Record<string, number> }>
  devices: CostDevice[]
  cumulative: Array<{ day: string, cumPkr: number }>
  budget: { green: number, red: number }
}

useSeoMeta({ title: 'Cost breakdown — Electricity Analytics' })

const route = useRoute()
const router = useRouter()
const RANGES = ['cycle', '7', '14', '30'] as const
const range = ref<string>(RANGES.includes(String(route.query.range) as typeof RANGES[number]) ? String(route.query.range) : 'cycle')
watch(range, () => {
  router.replace({ query: range.value === 'cycle' ? {} : { range: range.value } })
})

const { data: res, pending } = await useFetch<ApiEnvelope<CostData>>('/api/reports/cost', {
  query: computed(() => ({ range: range.value })),
  lazy: true,
  watch: [range],
  retry: 2,
  retryDelay: 1500
})
const data = computed(() => res.value?.data ?? null)

const colorById = computed(() => {
  const map: Record<string, string> = { baseline: BASELINE_COLOR }
  let i = 0
  for (const device of data.value?.devices ?? []) {
    if (device.role === 'plug') {
      map[device.id] = deviceColor(i++)
    }
  }
  return map
})

const fmt = (n: number) => Math.round(n).toLocaleString('en-IN')
const fmt1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString('en-IN')

/** Stacked daily-cost bars — today's partial bar dimmed. */
const stackOption = computed(() => {
  const d = data.value
  if (!d) {
    return {}
  }
  const seriesIds = [...d.devices.filter(x => x.role === 'plug').map(x => x.id), 'baseline']
  const nameById: Record<string, string> = { baseline: 'Baseline' }
  for (const device of d.devices) {
    nameById[device.id] = device.name
  }
  return {
    grid: { left: 52, right: 12, top: 30, bottom: 28 },
    legend: {
      top: 0,
      textStyle: { color: '#8695a6', fontFamily: 'IBM Plex Mono', fontSize: 10 },
      itemWidth: 10,
      itemHeight: 10
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#0b111a',
      borderColor: 'rgba(255,255,255,.1)',
      textStyle: { color: '#e7eef5', fontFamily: 'IBM Plex Mono', fontSize: 12 },
      formatter: (params: Array<{ dataIndex: number, seriesName: string, value: number, marker: string }>) => {
        const first = params[0]
        if (!first) {
          return ''
        }
        const day = d.days[first.dataIndex]
        if (!day) {
          return ''
        }
        const lines = params
          .filter(p => p.value > 0.5)
          .map(p => `${p.marker} ${p.seriesName}: Rs ${Math.round(p.value).toLocaleString('en-IN')}`)
        return `<b>${formatDayLong(day.day)}${day.partial ? ' (so far)' : ''}</b><br/>${lines.join('<br/>')}<br/><b>Total: Rs ${Math.round(day.totalPkr).toLocaleString('en-IN')}</b>`
      }
    },
    xAxis: {
      type: 'category',
      data: d.days.map(x => formatDayShort(x.day)),
      axisLabel: { color: '#5b6a7c', fontFamily: 'IBM Plex Mono', fontSize: 9, hideOverlap: true },
      axisLine: { lineStyle: { color: 'rgba(255,255,255,.12)' } },
      axisTick: { show: false }
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: 'rgba(255,255,255,.05)' } },
      axisLabel: {
        color: '#5b6a7c',
        fontFamily: 'IBM Plex Mono',
        fontSize: 9,
        formatter: (v: number) => `Rs ${v >= 1000 ? `${v / 1000}k` : v}`
      }
    },
    series: seriesIds.map(id => ({
      name: nameById[id],
      type: 'bar',
      stack: 'cost',
      barMaxWidth: 26,
      data: d.days.map(x => ({
        value: Math.round(x.perDevicePkr[id] ?? 0),
        itemStyle: {
          color: colorById.value[id],
          opacity: x.partial ? 0.45 : 0.88
        }
      }))
    }))
  }
})

/** Cumulative spend vs budget lines — cycle mode only. */
const cumulativeOption = computed(() => {
  const d = data.value
  if (!d || d.cumulative.length === 0) {
    return {}
  }
  return {
    grid: { left: 52, right: 12, top: 16, bottom: 28 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#0b111a',
      borderColor: 'rgba(255,255,255,.1)',
      textStyle: { color: '#e7eef5', fontFamily: 'IBM Plex Mono', fontSize: 12 },
      valueFormatter: (v: number) => `Rs ${Math.round(v).toLocaleString('en-IN')}`
    },
    xAxis: {
      type: 'category',
      data: d.cumulative.map(x => formatDayShort(x.day)),
      axisLabel: { color: '#5b6a7c', fontFamily: 'IBM Plex Mono', fontSize: 9, hideOverlap: true },
      axisLine: { lineStyle: { color: 'rgba(255,255,255,.12)' } },
      axisTick: { show: false }
    },
    yAxis: {
      type: 'value',
      max: (v: { max: number }) => Math.max(v.max, d.budget.red) * 1.1,
      splitLine: { lineStyle: { color: 'rgba(255,255,255,.05)' } },
      axisLabel: {
        color: '#5b6a7c',
        fontFamily: 'IBM Plex Mono',
        fontSize: 9,
        formatter: (v: number) => `${Math.round(v / 1000)}k`
      }
    },
    series: [{
      name: 'Spend',
      type: 'line',
      showSymbol: false,
      data: d.cumulative.map(x => x.cumPkr),
      lineStyle: { color: '#4ad4ff', width: 2 },
      areaStyle: { color: '#4ad4ff', opacity: 0.07 },
      markLine: {
        silent: true,
        symbol: 'none',
        data: [
          { yAxis: d.budget.green, lineStyle: { color: '#34e8a4', type: 'dashed' }, label: { formatter: 'green', color: '#34e8a4', fontFamily: 'IBM Plex Mono', fontSize: 9 } },
          { yAxis: d.budget.red, lineStyle: { color: '#ff6376', type: 'dashed' }, label: { formatter: 'red', color: '#ff6376', fontFamily: 'IBM Plex Mono', fontSize: 9 } }
        ]
      }
    }]
  }
})
</script>

<template>
  <UContainer class="py-6 space-y-4">
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <div class="flex items-center gap-2">
        <UButton
          to="/"
          variant="ghost"
          color="neutral"
          icon="i-lucide-chevron-left"
          size="sm"
          aria-label="Back to dashboard"
        />
        <div>
          <h1 class="text-sm font-semibold flex items-center gap-2">
            <UIcon
              name="i-lucide-wallet"
              class="size-4 text-primary"
            />
            Cost breakdown
          </h1>
          <p
            v-if="data"
            class="microlabel text-dimmed mt-0.5"
          >
            @ Rs {{ data.ratePkrPerUnit }}/unit ({{ data.rateSource === 'bill' ? 'your bill' : 'slab estimate' }})
          </p>
        </div>
      </div>
      <div class="flex rounded-lg bg-elevated/70 p-0.5 gap-0.5">
        <UButton
          v-for="r in RANGES"
          :key="r"
          size="xs"
          :variant="range === r ? 'soft' : 'ghost'"
          :color="range === r ? 'primary' : 'neutral'"
          :label="r === 'cycle' ? 'this cycle' : `${r}d`"
          @click="range = r"
        />
      </div>
    </div>

    <div
      v-if="pending && !data"
      class="flex items-center gap-2 justify-center text-muted py-20"
    >
      <UIcon
        name="i-lucide-loader-circle"
        class="size-5 animate-spin"
      /> Loading…
    </div>

    <template v-else-if="data">
      <!-- Total for the range -->
      <div class="panel p-5 flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <p class="microlabel text-dimmed">
            {{ range === 'cycle' ? `This cycle · day ${data.cycle.daysElapsed} of ${data.cycle.daysTotal}` : `Last ${range} days` }}
          </p>
          <p class="num text-3xl font-bold mt-1">
            Rs {{ fmt(data.totals.costPkr) }}
          </p>
        </div>
        <p class="num text-sm text-muted">
          {{ fmt1(data.totals.kwh) }} kWh total
        </p>
      </div>

      <!-- Per-device cards -->
      <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div
          v-for="device in data.devices"
          :key="device.id"
          class="panel p-4"
        >
          <div class="flex items-center gap-2.5">
            <span
              class="size-2.5 rounded shrink-0"
              :style="{ background: colorById[device.id], boxShadow: `0 0 8px ${colorById[device.id]}` }"
            />
            <p class="text-sm font-medium truncate flex-1">
              {{ device.name }}
            </p>
            <span class="num text-xs text-muted">{{ device.sharePct }}%</span>
          </div>
          <p class="num text-2xl font-bold mt-3 leading-none">
            Rs {{ fmt(device.costPkr) }}
          </p>
          <p class="num text-xs text-muted mt-1.5">
            {{ fmt1(device.kwh) }} kWh · today Rs {{ fmt(device.todayCostPkr) }} · avg {{ fmt1(device.avgPerDayKwh) }} kWh/d
          </p>
          <p
            v-if="device.projectedCyclePkr !== null"
            class="num text-xs mt-1"
            :class="device.projectedCyclePkr > 15000 ? 'text-[#ffbc57]' : 'text-muted'"
          >
            → ≈ Rs {{ fmt(device.projectedCyclePkr) }} by cycle end
          </p>
          <span
            class="mt-3 block h-1.5 rounded bg-elevated overflow-hidden"
          >
            <span
              class="block h-full rounded"
              :style="{ width: `${device.sharePct}%`, background: colorById[device.id] }"
            />
          </span>
        </div>
      </div>

      <!-- Stacked daily cost -->
      <div class="panel p-5">
        <div class="flex items-center justify-between mb-2">
          <h2 class="text-sm font-semibold">
            Daily cost by device
          </h2>
          <span class="microlabel text-dimmed">today's bar = partial</span>
        </div>
        <ClientOnly>
          <VChart
            v-if="data.days.length > 0"
            :option="stackOption"
            :autoresize="true"
            class="w-full"
            :style="{ height: '260px', width: '100%' }"
          />
          <p
            v-else
            class="text-sm text-muted text-center py-10"
          >
            No data in this range yet.
          </p>
          <template #fallback>
            <div style="height: 260px" />
          </template>
        </ClientOnly>
      </div>

      <!-- Cumulative spend vs budget (cycle mode only) -->
      <div
        v-if="range === 'cycle' && data.cumulative.length > 1"
        class="panel p-5"
      >
        <div class="flex items-center justify-between mb-2">
          <h2 class="text-sm font-semibold">
            Cumulative spend vs budget
          </h2>
          <span class="microlabel text-dimmed">green Rs {{ Math.round(data.budget.green / 1000) }}k · red Rs {{ Math.round(data.budget.red / 1000) }}k</span>
        </div>
        <ClientOnly>
          <VChart
            :option="cumulativeOption"
            :autoresize="true"
            class="w-full"
            :style="{ height: '220px', width: '100%' }"
          />
          <template #fallback>
            <div style="height: 220px" />
          </template>
        </ClientOnly>
      </div>

      <p class="text-[11px] text-dimmed leading-relaxed">
        Per-device cost = measured kWh × your blended effective rate. Under slab pricing the
        “expensive slab” isn’t attributable to a single device, so flat-rate attribution is used —
        consistent across the app. Rare clock-skew days are reconciled so each day’s stack sums to the
        breaker’s authoritative total.
      </p>
    </template>
  </UContainer>
</template>
