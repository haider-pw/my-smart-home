<script setup lang="ts">
/**
 * Faithful SVG port of the v2 design's bill gauge: half-circle arc with
 * glow + value arcs, budget tick marks on the rim, endpoint dot, and the
 * projected amount sitting in the open space beneath the arc.
 */
const props = defineProps<{
  projectedPkr: number
  cycleSoFarPkr: number
  projectedUnits: number
  budgetGreen: number
  budgetRed: number
  budgetStatus: 'green' | 'amber' | 'red'
  cycleLabel: string
}>()

const CX = 180
const CY = 158
const R = 132
const STROKE = 15

const statusColor = computed(() =>
  props.budgetStatus === 'green' ? '#34e8a4' : props.budgetStatus === 'amber' ? '#ffbc57' : '#ff6376'
)

const gaugeMax = computed(() => Math.max(
  props.budgetRed * 1.35,
  Math.ceil(props.projectedPkr / 5000) * 5000 + 5000
))

/** Point on the half-circle: value 0..max sweeps 180°→0° (left→right). */
function polar(value: number, radius: number): [number, number] {
  const angle = ((180 - (Math.min(Math.max(value, 0), gaugeMax.value) / gaugeMax.value) * 180) * Math.PI) / 180
  return [CX + radius * Math.cos(angle), CY - radius * Math.sin(angle)]
}

function arcPath(from: number, to: number): string {
  const [x0, y0] = polar(from, R)
  const [x1, y1] = polar(to, R)
  return `M${x0} ${y0} A${R} ${R} 0 0 1 ${x1} ${y1}`
}

const trackPath = computed(() => arcPath(0, gaugeMax.value))
const valuePath = computed(() => arcPath(0, props.projectedPkr))
const endpoint = computed(() => polar(props.projectedPkr, R))

interface Tick {
  line: { x1: number, y1: number, x2: number, y2: number }
  label: { x: number, y: number, text: string }
  color: string
}

const ticks = computed<Tick[]>(() => [
  { value: props.budgetGreen, color: '#34e8a4' },
  { value: props.budgetRed, color: '#ff6376' }
].filter(t => t.value < gaugeMax.value).map((t) => {
  const [x1, y1] = polar(t.value, R - 13)
  const [x2, y2] = polar(t.value, R + 13)
  const [lx, ly] = polar(t.value, R + 27)
  return {
    line: { x1, y1, x2, y2 },
    label: { x: lx, y: ly + 3, text: `${Math.round(t.value / 1000)}k` },
    color: t.color
  }
}))

const maxLabel = computed(() => `${Math.round(gaugeMax.value / 1000)}k`)
const fmt = (n: number) => Math.round(n).toLocaleString('en-IN')
</script>

<template>
  <div class="relative mx-auto w-full max-w-[400px]">
    <svg
      viewBox="0 0 360 178"
      class="w-full h-auto block overflow-visible"
      role="img"
      :aria-label="`Projected bill PKR ${fmt(projectedPkr)}`"
    >
      <!-- track -->
      <path
        :d="trackPath"
        fill="none"
        stroke="#141d2a"
        :stroke-width="STROKE"
        stroke-linecap="round"
      />
      <!-- glow -->
      <path
        :d="valuePath"
        fill="none"
        :stroke="statusColor"
        :stroke-width="STROKE + 12"
        stroke-linecap="round"
        opacity="0.14"
      />
      <!-- value -->
      <path
        :d="valuePath"
        fill="none"
        :stroke="statusColor"
        :stroke-width="STROKE"
        stroke-linecap="round"
      />
      <!-- budget ticks -->
      <g
        v-for="tick in ticks"
        :key="tick.label.text"
      >
        <line
          v-bind="tick.line"
          :stroke="tick.color"
          stroke-width="2"
          opacity="0.8"
        />
        <text
          :x="tick.label.x"
          :y="tick.label.y"
          font-size="10"
          fill="#5b6a7c"
          font-family="IBM Plex Mono, monospace"
          text-anchor="middle"
        >{{ tick.label.text }}</text>
      </g>
      <!-- endpoint dot -->
      <circle
        :cx="endpoint[0]"
        :cy="endpoint[1]"
        r="10"
        :fill="statusColor"
        opacity="0.22"
      />
      <circle
        :cx="endpoint[0]"
        :cy="endpoint[1]"
        r="5"
        fill="#fff"
        :stroke="statusColor"
        stroke-width="3"
      />
      <!-- scale end labels -->
      <text
        :x="CX - R"
        :y="CY + 16"
        font-size="10"
        fill="#5b6a7c"
        font-family="IBM Plex Mono, monospace"
        text-anchor="middle"
      >0</text>
      <text
        :x="CX + R"
        :y="CY + 16"
        font-size="10"
        fill="#5b6a7c"
        font-family="IBM Plex Mono, monospace"
        text-anchor="middle"
      >{{ maxLabel }}</text>
    </svg>

    <!-- value block in the open space beneath the arc -->
    <div class="absolute inset-x-0 bottom-0.5 text-center pointer-events-none">
      <p class="microlabel text-dimmed !text-[10px]">
        Projected · {{ cycleLabel }}
      </p>
      <p
        class="num font-bold leading-none mt-1.5 text-[clamp(30px,4.5vw,42px)]"
        :style="{ color: statusColor }"
      >
        <span class="text-[0.45em] text-muted font-semibold align-baseline mr-1.5">PKR</span>{{ fmt(projectedPkr) }}
      </p>
      <p class="num text-xs text-muted mt-1.5">
        Rs {{ fmt(cycleSoFarPkr) }} so far · {{ fmt(projectedUnits) }} units projected
      </p>
    </div>
  </div>
</template>
