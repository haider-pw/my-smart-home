<script setup lang="ts">
import { MONTH_LABELS, buildRecommendations, type SummaryData } from '~/utils/dashboard'

interface ApiEnvelope<T> {
  success: boolean
  data: T | null
  error: string | null
}

interface TrendData {
  bucket: 'day' | 'hour'
  points: Array<{ day?: string, hourStart?: number, kwh: number }>
}

interface HeatmapData {
  from: number
  cells: Array<{ day: string, hour: number, kwh: number }>
}

useSeoMeta({ title: 'Dashboard — Electricity Analytics' })

const timeframe = ref<'7d' | '14d' | '30d'>('7d')
const timeframeDays = computed(() => Number(timeframe.value.replace('d', '')))

const { data: summaryRes, pending: summaryPending, refresh: refreshSummary } = await useFetch<ApiEnvelope<SummaryData>>(
  '/api/reports/summary',
  { lazy: true }
)
const { data: trendRes } = await useFetch<ApiEnvelope<TrendData>>(
  '/api/reports/trend',
  { query: computed(() => ({ bucket: 'day', days: timeframeDays.value })), lazy: true, watch: [timeframeDays] }
)
const { data: heatmapRes } = await useFetch<ApiEnvelope<HeatmapData>>(
  '/api/reports/heatmap',
  { query: { days: 7 }, lazy: true }
)

const summary = computed(() => summaryRes.value?.data ?? null)

const cycleLabel = computed(() => {
  if (!summary.value) {
    return ''
  }
  const start = new Date(summary.value.cycle.startTs + 5 * 3600 * 1000)
  return `${start.getUTCDate()} ${MONTH_LABELS[start.getUTCMonth()]} cycle`
})

const trendPoints = computed(() =>
  (trendRes.value?.data?.points ?? []).map(p => ({
    label: (p.day ?? '').slice(5),
    kwh: p.kwh
  }))
)

const donutSlices = computed(() => {
  const s = summary.value
  if (!s) {
    return []
  }
  const palette = ['#a98bff', '#34e8a4', '#ffbc57']
  const plugs = s.devices.filter(d => d.role === 'plug')
  const slices = plugs.map((d, i) => ({
    name: d.name,
    kwh: d.cycleKwh,
    costPkr: d.cycleCostPkr,
    color: palette[i % palette.length]!
  }))
  const baselineCost = s.cost.cycleSoFarPkr - plugs.reduce((a, d) => a + d.cycleCostPkr, 0)
  slices.push({ name: 'Baseline (unmetered)', kwh: s.units.baseline, costPkr: Math.max(baselineCost, 0), color: '#6b7a8b' })
  return slices
})

const kpis = computed(() => {
  const s = summary.value
  if (!s) {
    return []
  }
  const fmt1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString('en-IN')
  const fmt = (n: number) => Math.round(n).toLocaleString('en-IN')
  const avgPerDay = s.units.cycle / Math.max(s.cycle.daysElapsed, 1)
  const overPace = avgPerDay > s.cost.greenPaceKwhPerDay
  return [
    { label: `Units — ${cycleLabel.value}`, value: fmt(s.units.cycle), unit: 'kWh', sub: `day ${s.cycle.daysElapsed} of ${s.cycle.daysTotal}`, tone: 'cyan' as const },
    { label: 'Cost so far', value: `Rs ${fmt(s.cost.cycleSoFarPkr)}`, sub: s.tariff.config.effectiveRatePkr ? `@ Rs ${s.tariff.config.effectiveRatePkr}/unit (your bill)` : 'slab-model estimate', tone: 'default' as const },
    { label: 'Avg / day', value: fmt1(avgPerDay), unit: 'kWh', sub: `${overPace ? '▲ over' : '▼ under'} pace of ${fmt1(s.cost.greenPaceKwhPerDay)}`, tone: overPace ? 'amber' as const : 'green' as const },
    { label: 'Next unit costs', value: `Rs ${s.slab.current.marginalRate}`, sub: Number.isFinite(s.slab.current.unitsToNext) ? `${fmt(s.slab.current.unitsToNext)} units to next slab` : 'top slab — max rate', tone: 'amber' as const }
  ]
})

const recommendations = computed(() => (summary.value ? buildRecommendations(summary.value) : []))
const isTouMeter = computed(() => summary.value?.tariff.config.meterType === 'tou')
</script>

<template>
  <UContainer class="py-6 space-y-4 sm:space-y-5">
    <!-- Health banners -->
    <UAlert
      v-if="summary?.health.tuyaAuthError"
      color="error"
      variant="subtle"
      icon="i-lucide-plug-zap"
      title="Tuya connection failing"
      :description="`${summary.health.tuyaAuthError.message} — check the trial subscription / credentials in the Tuya console.`"
    />
    <UAlert
      v-else-if="summary?.health.pollStale"
      color="warning"
      variant="subtle"
      icon="i-lucide-clock-alert"
      title="Data collection is stale"
      :description="summary?.health.lastPollAt ? `Last poll ${Math.round((summary.generatedAt - summary.health.lastPollAt) / 60000)} min ago — check the Cronicle job.` : 'No polls recorded yet.'"
    />
    <UAlert
      v-if="summary?.tariff.isDefault"
      color="info"
      variant="subtle"
      icon="i-lucide-receipt"
      title="Tariff running on defaults"
      description="Enter your real bill's effective rate and meter-reading day in settings for accurate PKR figures."
    />

    <div
      v-if="summaryPending && !summary"
      class="flex items-center gap-2 justify-center text-muted py-24"
    >
      <UIcon
        name="i-lucide-loader-circle"
        class="size-5 animate-spin"
      /> Loading your data…
    </div>

    <template v-else-if="summary">
      <!-- Hero: gauge + recommendations -->
      <div class="grid lg:grid-cols-2 gap-4 sm:gap-5">
        <div class="panel p-5">
          <div class="flex items-center justify-between mb-2">
            <h2 class="text-sm font-semibold">
              Projected bill
            </h2>
            <UBadge
              :color="summary.cost.budgetStatus === 'green' ? 'success' : summary.cost.budgetStatus === 'amber' ? 'warning' : 'error'"
              variant="subtle"
            >
              {{ summary.cost.budgetStatus === 'green' ? 'On target' : summary.cost.budgetStatus === 'amber' ? 'Watch' : 'Over budget' }}
            </UBadge>
          </div>
          <DashboardBillGauge
            :projected-pkr="summary.cost.projectedPkr"
            :cycle-so-far-pkr="summary.cost.cycleSoFarPkr"
            :projected-units="summary.cost.projectedUnits"
            :budget-green="summary.tariff.config.budget.green"
            :budget-red="summary.tariff.config.budget.red"
            :budget-status="summary.cost.budgetStatus"
            :cycle-label="cycleLabel"
          />
          <DashboardBudgetChips
            :green="summary.tariff.config.budget.green"
            :red="summary.tariff.config.budget.red"
            :status="summary.cost.budgetStatus"
          />
        </div>

        <div class="panel p-5">
          <div class="flex items-center justify-between mb-3">
            <h2 class="text-sm font-semibold">
              What to change — ranked
            </h2>
            <span class="microlabel text-dimmed">save the most</span>
          </div>
          <DashboardSaveActions :recommendations="recommendations" />
        </div>
      </div>

      <!-- KPI row -->
      <DashboardKpiCards :kpis="kpis" />

      <!-- Slab ladder -->
      <div class="panel p-5">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-sm font-semibold">
            Billing slab ladder — {{ summary.tariff.config.category }}
          </h2>
          <span class="microlabel text-dimmed">PKR / unit</span>
        </div>
        <DashboardSlabLadder
          :table="summary.slab.table"
          :cycle-units="summary.units.cycle"
          :current-index="summary.slab.current.index"
          :marginal-rate="summary.slab.current.marginalRate"
          :units-to-next="summary.slab.current.unitsToNext"
        />
      </div>

      <!-- Trend + donut -->
      <div class="grid lg:grid-cols-5 gap-4 sm:gap-5">
        <div class="panel p-5 lg:col-span-3">
          <div class="flex items-center justify-between mb-2 gap-2 flex-wrap">
            <h2 class="text-sm font-semibold">
              Daily consumption
            </h2>
            <div class="flex rounded-lg bg-elevated/70 p-0.5 gap-0.5">
              <UButton
                v-for="tf in (['7d', '14d', '30d'] as const)"
                :key="tf"
                size="xs"
                :variant="timeframe === tf ? 'soft' : 'ghost'"
                :color="timeframe === tf ? 'primary' : 'neutral'"
                :label="tf"
                @click="timeframe = tf"
              />
            </div>
          </div>
          <DashboardTrendChart
            :points="trendPoints"
            :pace-kwh-per-day="summary.cost.greenPaceKwhPerDay"
          />
        </div>
        <div class="panel p-5 lg:col-span-2">
          <div class="flex items-center justify-between mb-2">
            <h2 class="text-sm font-semibold">
              Where the money goes
            </h2>
            <span class="microlabel text-dimmed">this cycle</span>
          </div>
          <DashboardCostDonut
            :slices="donutSlices"
            :total-pkr="summary.cost.cycleSoFarPkr"
          />
        </div>
      </div>

      <!-- Heatmap -->
      <div class="panel p-5">
        <div class="flex items-center justify-between mb-2">
          <h2 class="text-sm font-semibold">
            Usage heatmap — last 7 days
          </h2>
          <span class="microlabel text-dimmed">brighter = more kWh</span>
        </div>
        <DashboardPeakHeatmap
          v-if="heatmapRes?.data"
          :cells="heatmapRes.data.cells"
          :peak-hours="summary.tariff.config.tou.peakHours"
        />
      </div>

      <!-- Device table -->
      <div class="panel p-5">
        <div class="flex items-center justify-between mb-2">
          <h2 class="text-sm font-semibold">
            Device breakdown
          </h2>
          <UButton
            size="xs"
            variant="ghost"
            color="neutral"
            icon="i-lucide-refresh-cw"
            :loading="summaryPending"
            @click="() => refreshSummary()"
          />
        </div>
        <DashboardDeviceTable
          :devices="summary.devices"
          :baseline-kwh="summary.units.baseline"
          :baseline-cost-pkr="Math.max(summary.cost.cycleSoFarPkr - summary.devices.filter(d => d.role === 'plug').reduce((a, d) => a + d.cycleCostPkr, 0), 0)"
          :total-kwh="summary.units.cycle"
          :soft-peak="!isTouMeter"
        />
      </div>
    </template>
  </UContainer>
</template>
