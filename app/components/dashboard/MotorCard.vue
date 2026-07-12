<script setup lang="ts">
import { formatClockPkt, formatDayShort, formatMinutes } from '~/utils/format'

export interface MotorData {
  device: { id: string, name: string, online: boolean | null }
  detection: 'events' | 'signature'
  todayKey: string
  ratedWatts: number
  isDefaultRating: boolean
  state: { running: boolean, sinceTs: number | null, minutes: number }
  today: { fills: number, minutes: number, estKwh: number, estPkr: number }
  window: { days: number, fills: number, minutes: number, estKwh: number, estPkr: number }
  perDay: Array<{ day: string, fills: number, minutes: number, estKwh: number, estPkr: number }>
  lastRun: { startTs: number, endTs: number | null, minutes: number, capped: boolean } | null
}

const props = defineProps<{ motor: MotorData }>()

const fmt = (n: number) => Math.round(n).toLocaleString('en-IN')

const maxDayMinutes = computed(() =>
  Math.max(...props.motor.perDay.map(d => d.minutes), 1)
)

const lastRunLabel = computed(() => {
  const run = props.motor.lastRun
  if (!run) {
    return 'No runs recorded yet'
  }
  return `Last run ${formatClockPkt(run.startTs)} · ${formatMinutes(run.minutes)}`
})
</script>

<template>
  <div class="panel p-5">
    <div class="flex items-center justify-between mb-3 gap-2 flex-wrap">
      <h2 class="text-sm font-semibold flex items-center gap-2">
        <UIcon
          name="i-lucide-droplets"
          class="size-4 text-[#4ad4ff]"
        />
        {{ motor.device.name }}
        <UTooltip
          v-if="motor.detection === 'signature'"
          text="Runs inferred from motor-sized power steps in the house baseline — timing is approximate until the metering breaker is installed."
        >
          <UBadge
            color="warning"
            variant="subtle"
            size="sm"
          >
            approx
          </UBadge>
        </UTooltip>
      </h2>
      <span
        class="microlabel flex items-center gap-1.5"
        :class="motor.state.running ? 'text-[#34e8a4]' : 'text-dimmed'"
      >
        <span
          class="size-1.5 rounded-full"
          :class="motor.state.running ? 'bg-[#34e8a4] animate-pulse' : motor.device.online === false ? 'bg-[#ff6376]' : 'bg-elevated'"
        />
        {{ motor.state.running ? `running · ${formatMinutes(motor.state.minutes)}` : motor.device.online === false ? 'offline' : 'idle' }}
      </span>
    </div>

    <div class="grid grid-cols-3 gap-3 mb-4">
      <div>
        <div class="microlabel text-dimmed mb-0.5">
          Fills today
        </div>
        <div class="text-lg font-semibold tabular-nums">
          {{ motor.today.fills }}
        </div>
      </div>
      <div>
        <div class="microlabel text-dimmed mb-0.5">
          Runtime today
        </div>
        <div class="text-lg font-semibold tabular-nums">
          {{ formatMinutes(motor.today.minutes) }}
        </div>
      </div>
      <div>
        <div class="microlabel text-dimmed mb-0.5">
          Cost today
        </div>
        <div class="text-lg font-semibold tabular-nums">
          ~Rs {{ fmt(motor.today.estPkr) }}
        </div>
      </div>
    </div>

    <!-- 7-day runtime bars -->
    <div class="flex items-end gap-1.5 h-16 mb-1">
      <div
        v-for="d in motor.perDay"
        :key="d.day"
        class="flex-1 flex flex-col items-center gap-1 min-w-0"
        :title="`${formatDayShort(d.day)}: ${d.fills} fills · ${formatMinutes(d.minutes)} · ~Rs ${fmt(d.estPkr)}`"
      >
        <div
          class="w-full rounded-sm bg-[#4ad4ff]"
          :style="{
            height: `${Math.max((d.minutes / maxDayMinutes) * 48, d.minutes > 0 ? 3 : 1)}px`,
            opacity: d.minutes === 0 ? 0.15 : d.day === motor.todayKey ? 0.45 : 0.88
          }"
        />
        <span class="microlabel text-dimmed truncate">{{ formatDayShort(d.day).split(' ')[0] }}</span>
      </div>
    </div>

    <div class="flex items-center justify-between gap-2 flex-wrap text-xs text-muted">
      <span>{{ lastRunLabel }}</span>
      <span class="text-dimmed">
        ~ estimated at {{ motor.ratedWatts }} W
        <NuxtLink
          v-if="motor.isDefaultRating"
          to="/settings"
          class="text-[#4ad4ff] hover:underline"
        >— set nameplate rating</NuxtLink>
      </span>
    </div>
  </div>
</template>
