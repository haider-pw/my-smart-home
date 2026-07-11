<script setup lang="ts">
const props = defineProps<{
  devices: Array<{
    id: string
    name: string
    role: string
    online: boolean | null
    cycleKwh: number
    todayKwh: number
    cycleCostPkr: number
    peakSharePct: number
  }>
  baselineKwh: number
  baselineCostPkr: number
  totalKwh: number
  softPeak: boolean
}>()

const palette: Record<string, string> = {
  breaker: '#4ad4ff',
  plug0: '#a98bff',
  plug1: '#34e8a4',
  plug2: '#ffbc57'
}

const rows = computed(() => {
  let plugIndex = 0
  const list = props.devices
    .filter(d => d.role !== 'breaker')
    .map((d) => {
      const color = palette[`plug${plugIndex++}`] ?? '#8695a6'
      return { ...d, color, tag: 'switch' }
    })
  list.push({
    id: '_baseline',
    name: 'Baseline (unmetered)',
    role: 'baseline',
    online: null,
    cycleKwh: props.baselineKwh,
    todayKwh: -1,
    cycleCostPkr: props.baselineCostPkr,
    peakSharePct: -1,
    color: '#6b7a8b',
    tag: 'breaker − plugs'
  })
  return list
})

const fmt = (n: number) => Math.round(n).toLocaleString('en-IN')
const fmt1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString('en-IN')
</script>

<template>
  <div class="overflow-x-auto">
    <table class="w-full text-sm">
      <thead>
        <tr class="text-left microlabel text-dimmed border-b border-default">
          <th class="py-2 pr-3 font-medium">
            Device
          </th>
          <th class="py-2 pr-3 text-right font-medium">
            Cycle
          </th>
          <th class="py-2 pr-3 text-right font-medium">
            Today
          </th>
          <th class="py-2 pr-3 text-right font-medium">
            Est. cost
          </th>
          <th
            class="py-2 pr-3 text-right font-medium"
            :title="softPeak ? 'Informational on a slab meter — timing does not change price' : undefined"
          >
            % in peak{{ softPeak ? ' ⓘ' : '' }}
          </th>
          <th class="py-2 text-right font-medium">
            Share
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.id"
          class="border-b border-default/40"
        >
          <td class="py-2.5 pr-3">
            <span class="flex items-center gap-2.5 font-medium">
              <span
                class="size-2.5 rounded shrink-0"
                :style="{ background: row.color, boxShadow: `0 0 8px ${row.color}` }"
              />
              <span class="truncate">{{ row.name }}</span>
              <UBadge
                variant="subtle"
                size="sm"
                :color="row.online === false ? 'error' : 'neutral'"
                class="microlabel !text-[8px]"
              >
                {{ row.online === false ? 'offline' : row.tag }}
              </UBadge>
            </span>
          </td>
          <td class="py-2.5 pr-3 text-right num">
            {{ fmt1(row.cycleKwh) }} kWh
          </td>
          <td class="py-2.5 pr-3 text-right num text-muted">
            {{ row.todayKwh >= 0 ? `${fmt1(row.todayKwh)} kWh` : '—' }}
          </td>
          <td class="py-2.5 pr-3 text-right num font-semibold">
            Rs {{ fmt(row.cycleCostPkr) }}
          </td>
          <td
            class="py-2.5 pr-3 text-right num"
            :class="!softPeak && row.peakSharePct >= 45 ? 'text-[#ff6376]' : !softPeak && row.peakSharePct >= 25 ? 'text-[#ffbc57]' : 'text-muted'"
          >
            {{ row.peakSharePct >= 0 ? `${row.peakSharePct}%` : '—' }}
          </td>
          <td class="py-2.5 text-right">
            <span class="inline-block h-1.5 w-20 rounded bg-elevated overflow-hidden align-middle">
              <span
                class="block h-full rounded"
                :style="{
                  width: `${totalKwh > 0 ? Math.min(Math.round(row.cycleKwh / totalKwh * 100), 100) : 0}%`,
                  background: row.color
                }"
              />
            </span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
