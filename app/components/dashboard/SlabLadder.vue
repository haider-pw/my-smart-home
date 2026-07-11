<script setup lang="ts">
const props = defineProps<{
  table: Array<{ upto: number | null, rate: number }>
  cycleUnits: number
  currentIndex: number
  marginalRate: number
  unitsToNext: number
}>()

const segments = computed(() => props.table.map((slab, i) => {
  const lower = i === 0 ? 0 : props.table[i - 1]!.upto ?? 0
  return {
    rate: slab.rate,
    range: slab.upto === null ? `${lower}+` : `${lower}–${slab.upto}`,
    state: i === props.currentIndex ? 'current' : i < props.currentIndex ? 'passed' : 'ahead'
  }
}))

const warnSoon = computed(() => Number.isFinite(props.unitsToNext) && props.unitsToNext < 60)

const note = computed(() => {
  if (warnSoon.value) {
    const next = props.table[props.currentIndex + 1]
    return `⚠ Only ${Math.round(props.unitsToNext)} units until the next slab — the marginal rate jumps from Rs ${props.marginalRate} to Rs ${next?.rate ?? '—'}/unit and earlier units get repriced.`
  }
  if (!Number.isFinite(props.unitsToNext)) {
    return `Top slab — every unit costs the maximum Rs ${props.marginalRate}.`
  }
  return `You're in the Rs ${props.marginalRate}/unit slab · ${Math.round(props.unitsToNext)} units of headroom this cycle.`
})
</script>

<template>
  <div>
    <div class="flex gap-1 sm:gap-1.5">
      <div
        v-for="(seg, i) in segments"
        :key="i"
        class="flex-1 text-center rounded-lg border py-2 px-0.5 transition"
        :class="{
          'border-[#ffbc57]/60 bg-[#ffbc57]/10 shadow-[0_0_18px_rgba(255,188,87,.15)]': seg.state === 'current',
          'border-[#34e8a4]/20 bg-[#34e8a4]/5': seg.state === 'passed',
          'border-default/50 opacity-55': seg.state === 'ahead'
        }"
      >
        <p
          class="num text-xs sm:text-sm font-bold"
          :class="seg.state === 'current' ? 'text-[#ffbc57]' : seg.state === 'passed' ? 'text-[#34e8a4]' : 'text-muted'"
        >
          {{ seg.rate }}
        </p>
        <p class="microlabel text-dimmed !text-[8px] mt-0.5 hidden sm:block">
          {{ seg.range }}
        </p>
      </div>
    </div>
    <p
      class="text-xs sm:text-sm mt-3 flex items-center gap-2"
      :class="warnSoon ? 'text-[#ffbc57]' : 'text-muted'"
    >
      <span
        class="inline-block size-1.5 rounded-full"
        :class="warnSoon ? 'bg-[#ffbc57] shadow-[0_0_8px_#ffbc57]' : 'bg-[#34e8a4]'"
      />
      {{ note }}
    </p>
  </div>
</template>
