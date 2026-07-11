<script setup lang="ts">
interface LiveDevice {
  id: string
  name: string
  role: 'breaker' | 'plug'
  online: boolean
  powerW: number | null
  voltageV: number | null
  currentA: number | null
  powerFactor: number | null
  leakageMa: number | null
  frequencyHz: number | null
  switchOn: boolean | null
  todayKwh: number
  todayCostPkr: number
}

interface LiveData {
  at: number
  devices: LiveDevice[]
  totals: {
    powerW: number
    burnPkrPerHour: number
    voltageV: number | null
    currentA: number | null
    frequencyHz: number | null
    leakageMa: number | null
    todayKwh: number
    todayCostPkr: number
  }
  thresholds: { greenAvgW: number, redAvgW: number, breakerRatedA: number }
  effectiveRatePkr: number
}

interface ApiEnvelope<T> {
  success: boolean
  data: T | null
  error: string | null
}

useSeoMeta({ title: 'Live Monitor — Electricity Analytics' })

// 5s polling while visible — half the lag of the previous 10s. The floor is
// the device's own cloud-report cadence; true push arrives with the Phase 8
// homelab Pulsar relay (SSE to the browser, Smart-Life-grade latency).
const REFRESH_MS = 5_000
const HISTORY_LENGTH = 180 // 180 × 5s = 15 min of sparkline

const live = ref<LiveData | null>(null)
const errorMsg = ref('')
const lastUpdated = ref<number | null>(null)
const history = reactive(new Map<string, number[]>())
const totalHistory = ref<number[]>([])

let timer: ReturnType<typeof setInterval> | null = null
let inFlight = false

async function tick() {
  if (inFlight || document.hidden) {
    return
  }
  inFlight = true
  try {
    const res = await $fetch<ApiEnvelope<LiveData>>('/api/live')
    if (res.data) {
      live.value = res.data
      lastUpdated.value = Date.now()
      errorMsg.value = ''
      for (const d of res.data.devices) {
        const arr = history.get(d.id) ?? []
        arr.push(d.powerW ?? 0)
        if (arr.length > HISTORY_LENGTH) {
          arr.shift()
        }
        history.set(d.id, [...arr])
      }
      totalHistory.value = [...totalHistory.value, res.data.totals.powerW].slice(-HISTORY_LENGTH)
    }
  } catch (error: unknown) {
    const err = error as { data?: { message?: string }, message?: string }
    errorMsg.value = err.data?.message ?? err.message ?? 'Live fetch failed'
  } finally {
    inFlight = false
  }
}

onMounted(() => {
  tick()
  timer = setInterval(tick, REFRESH_MS)
  document.addEventListener('visibilitychange', tick)
})
onBeforeUnmount(() => {
  if (timer) {
    clearInterval(timer)
  }
  document.removeEventListener('visibilitychange', tick)
})

const fmt = (n: number) => Math.round(n).toLocaleString('en-IN')
const fmt1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString('en-IN')

const loadTone = computed(() => {
  if (!live.value) {
    return '#8695a6'
  }
  const w = live.value.totals.powerW
  return w <= live.value.thresholds.greenAvgW ? '#34e8a4' : w <= live.value.thresholds.redAvgW ? '#ffbc57' : '#ff6376'
})

const capacityPct = computed(() => {
  if (!live.value?.totals.currentA) {
    return 0
  }
  return Math.min(Math.round((live.value.totals.currentA / live.value.thresholds.breakerRatedA) * 100), 100)
})

const deviceColors: Record<string, string> = {}
const palette = ['#4ad4ff', '#a98bff', '#34e8a4', '#ffbc57']
function colorFor(id: string, index: number): string {
  deviceColors[id] = deviceColors[id] ?? palette[index % palette.length]!
  return deviceColors[id]!
}

const heroStats = computed(() => {
  const t = live.value?.totals
  if (!t) {
    return []
  }
  return [
    { label: 'Total load', value: fmt(t.powerW), unit: 'W', tone: loadTone.value },
    { label: 'Burning right now', value: `Rs ${fmt1(t.burnPkrPerHour)}`, unit: '/hr', tone: loadTone.value },
    { label: 'Voltage', value: t.voltageV !== null ? fmt1(t.voltageV) : '—', unit: 'V', tone: t.voltageV !== null && (t.voltageV < 210 || t.voltageV > 250) ? '#ff6376' : undefined, sub: t.voltageV !== null && t.voltageV < 210 ? 'low — protect compressors' : undefined },
    { label: 'Load vs breaker', value: `${capacityPct.value}`, unit: `% of ${live.value?.thresholds.breakerRatedA} A`, tone: capacityPct.value > 80 ? '#ff6376' : undefined },
    { label: 'Today so far', value: fmt1(t.todayKwh), unit: 'kWh', sub: `Rs ${fmt(t.todayCostPkr)} since midnight` }
  ]
})
</script>

<template>
  <UContainer class="py-6 space-y-4">
    <div class="flex items-center gap-3 flex-wrap">
      <span class="relative flex size-2.5">
        <span
          class="absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping"
          :style="{ background: '#4ad4ff' }"
        />
        <span
          class="relative inline-flex size-2.5 rounded-full"
          :style="{ background: '#4ad4ff' }"
        />
      </span>
      <h1 class="text-sm font-semibold">
        Live Monitor
      </h1>
      <span class="microlabel text-dimmed">
        refreshes every 5s while visible · {{ lastUpdated ? `updated ${new Date(lastUpdated).toLocaleTimeString()}` : 'connecting…' }}
      </span>
    </div>

    <UAlert
      v-if="errorMsg"
      color="error"
      variant="subtle"
      icon="i-lucide-wifi-off"
      :description="errorMsg"
    />

    <div
      v-if="!live"
      class="flex items-center gap-2 justify-center text-muted py-24"
    >
      <UIcon
        name="i-lucide-loader-circle"
        class="size-5 animate-spin"
      /> Contacting devices…
    </div>

    <template v-else>
      <!-- Hero: whole-house -->
      <div class="panel p-5">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-sm font-semibold">
            Main breaker — whole house
          </h2>
          <span class="microlabel text-dimmed">rolling 15 min · 5s samples</span>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div
            v-for="stat in heroStats"
            :key="stat.label"
            class="rounded-xl border border-default/60 bg-elevated/40 px-4 py-3"
          >
            <p class="microlabel text-dimmed">
              {{ stat.label }}
            </p>
            <p
              class="num text-lg sm:text-xl font-bold mt-1.5 leading-none"
              :style="stat.tone ? { color: stat.tone } : undefined"
            >
              {{ stat.value }} <span class="text-xs text-muted font-medium">{{ stat.unit }}</span>
            </p>
            <p
              v-if="stat.sub"
              class="text-[11px] text-muted mt-1"
            >
              {{ stat.sub }}
            </p>
          </div>
        </div>
        <LiveSparkline
          :values="totalHistory"
          :color="loadTone"
          :height="72"
          class="mt-4"
        />
        <div class="flex gap-4 flex-wrap mt-2 microlabel text-dimmed !text-[9px]">
          <span class="flex items-center gap-1.5"><span class="size-2 rounded bg-[#34e8a4]" /> ≤ {{ fmt(live.thresholds.greenAvgW) }} W avg — green-budget pace</span>
          <span class="flex items-center gap-1.5"><span class="size-2 rounded bg-[#ffbc57]" /> heading over budget</span>
          <span class="flex items-center gap-1.5"><span class="size-2 rounded bg-[#ff6376]" /> &gt; {{ fmt(live.thresholds.redAvgW) }} W avg — past the red line</span>
        </div>
      </div>

      <!-- Per-device cards -->
      <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div
          v-for="(device, i) in live.devices"
          :key="device.id"
          class="panel p-4"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="flex items-center gap-2 text-sm font-medium min-w-0">
              <span
                class="size-2.5 rounded shrink-0"
                :style="{ background: colorFor(device.id, i), boxShadow: `0 0 8px ${colorFor(device.id, i)}` }"
              />
              <span class="truncate">{{ device.name }}</span>
            </span>
            <UBadge
              :color="device.online ? (device.switchOn === false ? 'neutral' : 'success') : 'error'"
              variant="subtle"
              size="sm"
            >
              {{ !device.online ? 'offline' : device.switchOn === false ? 'off' : 'on' }}
            </UBadge>
          </div>

          <p
            class="num text-3xl font-bold mt-3 leading-none"
            :class="(device.powerW ?? 0) < 5 ? 'text-dimmed' : ''"
          >
            {{ device.powerW !== null ? fmt(device.powerW) : '—' }}<span class="text-sm text-muted font-medium"> W</span>
          </p>

          <div class="flex gap-4 num text-xs text-muted mt-2.5">
            <span>{{ device.voltageV !== null ? fmt1(device.voltageV) : '—' }} V</span>
            <span>{{ device.currentA !== null ? device.currentA.toFixed(2) : '—' }} A</span>
            <span>PF {{ device.powerFactor !== null ? device.powerFactor.toFixed(2) : '—' }}</span>
            <span v-if="device.leakageMa !== null">{{ device.leakageMa }} mA leak</span>
          </div>

          <LiveSparkline
            :values="history.get(device.id) ?? []"
            :color="colorFor(device.id, i)"
            class="mt-3"
          />

          <div class="flex justify-between items-baseline text-xs border-t border-default/50 mt-3 pt-2.5">
            <span class="text-muted">Today</span>
            <span class="num text-muted">{{ fmt1(device.todayKwh) }} kWh</span>
            <span class="num font-bold">Rs {{ fmt(device.todayCostPkr) }}</span>
          </div>
        </div>
      </div>
    </template>
  </UContainer>
</template>
