<script setup lang="ts">
interface Outage {
  id: number
  startTs: number
  endTs: number | null
  durationMin: number | null
  kind: 'power' | 'internet' | 'unknown'
  registerDeltaKwh: number | null
}

interface OutagesData {
  days: number
  outages: Outage[]
  stats: {
    powerCount: number
    internetCount: number
    unknownCount: number
    totalPowerMinutes: number
    avgPowerMinutes: number
    longestPowerMinutes: number
  }
  hourHistogram: number[]
}

interface ApiEnvelope<T> {
  success: boolean
  data: T | null
  error: string | null
}

useSeoMeta({ title: 'Outages — Electricity Analytics' })

const range = ref<30 | 90 | 365>(90)
const { data: res, pending } = await useFetch<ApiEnvelope<OutagesData>>(
  '/api/reports/outages',
  { query: computed(() => ({ days: range.value })), lazy: true, watch: [range], retry: 2, retryDelay: 1500 }
)

const data = computed(() => res.value?.data ?? null)

const KIND_META = {
  power: { label: 'power outage', icon: '⚡', color: 'error' as const, hint: 'register frozen — mains were down (load-shedding)' },
  internet: { label: 'internet outage', icon: '🌐', color: 'info' as const, hint: 'register kept counting — only connectivity dropped' },
  unknown: { label: 'unclassified', icon: '·', color: 'neutral' as const, hint: 'no register evidence around the gap' }
}

function pkt(ts: number): string {
  return new Date(ts + 5 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 16)
}

function fmtDuration(min: number | null): string {
  if (min === null) {
    return 'ongoing'
  }
  if (min < 60) {
    return `${Math.round(min)} min`
  }
  return `${Math.floor(min / 60)}h ${Math.round(min % 60)}m`
}

const histogramOption = computed(() => ({
  grid: { left: 34, right: 8, top: 12, bottom: 24 },
  tooltip: {
    trigger: 'axis',
    backgroundColor: '#0b111a',
    borderColor: 'rgba(255,255,255,.1)',
    textStyle: { color: '#e7eef5', fontFamily: 'IBM Plex Mono', fontSize: 12 }
  },
  xAxis: {
    type: 'category',
    data: Array.from({ length: 24 }, (_, h) => (h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`)),
    axisLabel: { color: '#5b6a7c', fontFamily: 'IBM Plex Mono', fontSize: 9, interval: 2 },
    axisLine: { lineStyle: { color: 'rgba(255,255,255,.12)' } },
    axisTick: { show: false }
  },
  yAxis: {
    type: 'value',
    minInterval: 1,
    splitLine: { lineStyle: { color: 'rgba(255,255,255,.05)' } },
    axisLabel: { color: '#5b6a7c', fontFamily: 'IBM Plex Mono', fontSize: 9 }
  },
  series: [{
    type: 'bar',
    data: data.value?.hourHistogram ?? [],
    itemStyle: { color: 'rgba(255,99,118,.7)', borderRadius: [3, 3, 0, 0] },
    barMaxWidth: 18
  }]
}))
</script>

<template>
  <UContainer class="py-6 space-y-4">
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <div>
        <h1 class="text-sm font-semibold flex items-center gap-2">
          <UIcon
            name="i-lucide-zap-off"
            class="size-4 text-[#ff6376]"
          />
          Outage log
        </h1>
        <p class="microlabel text-dimmed mt-1">
          Load-shedding vs internet cuts — classified by the breaker's energy register
        </p>
      </div>
      <div class="flex rounded-lg bg-elevated/70 p-0.5 gap-0.5">
        <UButton
          v-for="r in ([30, 90, 365] as const)"
          :key="r"
          size="xs"
          :variant="range === r ? 'soft' : 'ghost'"
          :color="range === r ? 'primary' : 'neutral'"
          :label="`${r}d`"
          @click="range = r"
        />
      </div>
    </div>

    <div
      v-if="pending && !data"
      class="flex items-center gap-2 justify-center text-muted py-16"
    >
      <UIcon
        name="i-lucide-loader-circle"
        class="size-5 animate-spin"
      /> Loading…
    </div>

    <template v-else-if="data">
      <!-- stats row -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div class="panel p-4">
          <p class="microlabel text-dimmed">
            ⚡ Power outages
          </p>
          <p class="num text-2xl font-bold mt-2 text-[#ff6376]">
            {{ data.stats.powerCount }}
          </p>
          <p class="text-xs text-muted mt-1">
            in {{ data.days }} days
          </p>
        </div>
        <div class="panel p-4">
          <p class="microlabel text-dimmed">
            Time without power
          </p>
          <p class="num text-2xl font-bold mt-2">
            {{ fmtDuration(data.stats.totalPowerMinutes) }}
          </p>
          <p class="text-xs text-muted mt-1">
            avg {{ fmtDuration(data.stats.avgPowerMinutes) }} per outage
          </p>
        </div>
        <div class="panel p-4">
          <p class="microlabel text-dimmed">
            Longest outage
          </p>
          <p class="num text-2xl font-bold mt-2 text-[#ffbc57]">
            {{ fmtDuration(data.stats.longestPowerMinutes) }}
          </p>
        </div>
        <div class="panel p-4">
          <p class="microlabel text-dimmed">
            🌐 Internet cuts (PTCL)
          </p>
          <p class="num text-2xl font-bold mt-2 text-[#4ad4ff]">
            {{ data.stats.internetCount }}
          </p>
          <p class="text-xs text-muted mt-1">
            devices unreachable, power fine
          </p>
        </div>
      </div>

      <!-- hour pattern -->
      <div class="panel p-5">
        <div class="flex items-center justify-between mb-2">
          <h2 class="text-sm font-semibold">
            When the power goes — hour of day
          </h2>
          <span class="microlabel text-dimmed">power outages only · PKT</span>
        </div>
        <ClientOnly>
          <VChart
            :option="histogramOption"
            :autoresize="true"
            class="w-full"
            :style="{ height: '180px', width: '100%' }"
          />
          <template #fallback>
            <div style="height: 180px" />
          </template>
        </ClientOnly>
      </div>

      <!-- outage list -->
      <div class="panel p-5">
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-sm font-semibold">
            Events
          </h2>
          <UButton
            size="xs"
            variant="ghost"
            color="neutral"
            icon="i-lucide-download"
            label="CSV"
            :to="`/api/export/csv?dataset=outages&days=${range}`"
            external
          />
        </div>
        <p
          v-if="data.outages.length === 0"
          class="text-sm text-muted text-center py-8"
        >
          No outages recorded in this window — either lucky, or the history doesn't reach that far back yet.
        </p>
        <div
          v-else
          class="flex flex-col gap-2"
        >
          <div
            v-for="outage in data.outages"
            :key="outage.id"
            class="flex items-center gap-3 rounded-xl border border-default/60 bg-elevated/40 px-4 py-3 flex-wrap"
          >
            <span class="text-lg leading-none">{{ KIND_META[outage.kind].icon }}</span>
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium num">
                {{ pkt(outage.startTs) }} <span class="text-muted">→</span> {{ outage.endTs ? pkt(outage.endTs).slice(11) : '…' }}
              </p>
              <p class="text-[11px] text-muted mt-0.5">
                {{ KIND_META[outage.kind].hint }}
              </p>
            </div>
            <UBadge
              :color="KIND_META[outage.kind].color"
              variant="subtle"
              size="sm"
            >
              {{ KIND_META[outage.kind].label }}
            </UBadge>
            <span class="num text-sm font-bold min-w-16 text-right">
              {{ fmtDuration(outage.durationMin) }}
            </span>
          </div>
        </div>
      </div>
    </template>
  </UContainer>
</template>
