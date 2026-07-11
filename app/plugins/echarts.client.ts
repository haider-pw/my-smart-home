import { BarChart, GaugeChart, HeatmapChart, LineChart, PieChart } from 'echarts/charts'
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent
} from 'echarts/components'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import VChart from 'vue-echarts'

export default defineNuxtPlugin((nuxtApp) => {
  use([
    CanvasRenderer,
    BarChart,
    LineChart,
    PieChart,
    GaugeChart,
    HeatmapChart,
    GridComponent,
    TooltipComponent,
    LegendComponent,
    VisualMapComponent,
    MarkLineComponent,
    DataZoomComponent
  ])
  nuxtApp.vueApp.component('VChart', VChart)
})
