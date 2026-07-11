<script setup lang="ts">
interface StatusItem {
  code: string
  value: unknown
}

interface ExplorerDevice {
  id: string
  name: string
  category: string
  product_name?: string
  online: boolean
  status?: StatusItem[]
}

interface SpecFunction {
  code: string
  type: string
  values: string
}

interface DeviceDetail {
  device: ExplorerDevice
  status: StatusItem[]
  specification: {
    category: string
    functions: SpecFunction[]
    status: SpecFunction[]
  } | null
}

interface ApiEnvelope<T> {
  success: boolean
  data: T | null
  error: string | null
}

useSeoMeta({
  title: 'Device Explorer — Electricity Analytics'
})

const {
  data: devicesRes,
  pending: devicesPending,
  error: devicesError,
  refresh: refreshDevices
} = await useFetch<ApiEnvelope<{ region: string | null, count: number, devices: ExplorerDevice[] }>>(
  '/api/explorer/devices',
  { lazy: true }
)

const selectedId = ref<string | null>(null)

const {
  data: detailRes,
  pending: detailPending,
  error: detailError
} = await useFetch<ApiEnvelope<DeviceDetail>>(
  () => `/api/explorer/${selectedId.value}`,
  {
    lazy: true,
    immediate: false,
    watch: [selectedId]
  }
)

function selectDevice(id: string) {
  selectedId.value = selectedId.value === id ? null : id
}

/**
 * Merge the spec (what DPs CAN exist, with types/ranges) with live status
 * (what they report right now) into one review-friendly table.
 */
const dpRows = computed(() => {
  const detail = detailRes.value?.data
  if (!detail) {
    return []
  }
  const liveByCode = new Map(detail.status.map(s => [s.code, s.value]))
  const specByCode = new Map((detail.specification?.status ?? []).map(s => [s.code, s]))
  const codes = new Set([...liveByCode.keys(), ...specByCode.keys()])

  return Array.from(codes).map((code) => {
    const spec = specByCode.get(code)
    const live = liveByCode.get(code)
    return {
      code,
      type: spec?.type ?? '—',
      value: live === undefined ? '—' : JSON.stringify(live),
      spec: spec?.values ?? '—'
    }
  }).sort((a, b) => a.code.localeCompare(b.code))
})

const errorMessage = computed(() =>
  devicesRes.value?.error
  ?? (devicesError.value ? String(devicesError.value.data?.error ?? devicesError.value.message) : null)
)

const rawDetailJson = computed(() =>
  detailRes.value?.data ? JSON.stringify(detailRes.value.data, null, 2) : ''
)
</script>

<template>
  <UContainer class="py-8 space-y-6">
    <div class="flex items-center justify-between gap-4 flex-wrap">
      <div>
        <h1 class="text-xl font-bold flex items-center gap-2">
          <UIcon
            name="i-lucide-search-code"
            class="size-5 text-primary"
          />
          Device Explorer
        </h1>
        <p class="text-sm text-muted mt-1">
          Every device on your linked Smart Life account and every data point (DP) it exposes.
          This is the ground truth the reports get built on.
        </p>
      </div>
      <div class="flex items-center gap-3">
        <UBadge
          v-if="devicesRes?.data?.region"
          color="info"
          variant="subtle"
        >
          region: {{ devicesRes.data.region }}
        </UBadge>
        <UButton
          icon="i-lucide-refresh-cw"
          variant="soft"
          :loading="devicesPending"
          label="Refresh"
          @click="() => refreshDevices()"
        />
      </div>
    </div>

    <UAlert
      v-if="errorMessage"
      color="error"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="Tuya API error"
      :description="errorMessage"
    >
      <template #actions>
        <div class="text-xs text-muted space-y-1">
          <p>Common fixes in the Tuya console (platform.tuya.com):</p>
          <p>1. Cloud → your project → <b>Devices → Link App Account</b> — link the Smart Life app.</p>
          <p>2. <b>Service API</b> tab — authorize “IoT Core” and “Smart Home Basic Service”.</p>
          <p>3. Check the credentials in <code>.env</code> and your data center region.</p>
        </div>
      </template>
    </UAlert>

    <div
      v-if="devicesPending"
      class="flex items-center gap-2 text-muted py-12 justify-center"
    >
      <UIcon
        name="i-lucide-loader-circle"
        class="size-5 animate-spin"
      />
      Contacting Tuya…
    </div>

    <template v-else-if="devicesRes?.data">
      <p
        v-if="devicesRes.data.count === 0"
        class="text-muted"
      >
        No devices found — is the Smart Life app account linked in the Tuya console?
      </p>

      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <UCard
          v-for="device in devicesRes.data.devices"
          :key="device.id"
          class="cursor-pointer transition hover:ring-2 hover:ring-primary/50"
          :class="selectedId === device.id ? 'ring-2 ring-primary' : ''"
          @click="selectDevice(device.id)"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="font-semibold truncate">
                {{ device.name }}
              </p>
              <p class="text-xs text-muted truncate">
                {{ device.product_name ?? '—' }} · <code>{{ device.category }}</code>
              </p>
              <p class="text-[11px] text-dimmed mt-1 font-mono truncate">
                {{ device.id }}
              </p>
            </div>
            <UBadge
              :color="device.online ? 'success' : 'error'"
              variant="subtle"
              size="sm"
            >
              {{ device.online ? 'online' : 'offline' }}
            </UBadge>
          </div>
          <p class="text-xs text-muted mt-3">
            {{ device.status?.length ?? 0 }} live DPs · click to inspect
          </p>
        </UCard>
      </div>
    </template>

    <template v-if="selectedId">
      <USeparator />

      <div
        v-if="detailPending"
        class="flex items-center gap-2 text-muted py-8 justify-center"
      >
        <UIcon
          name="i-lucide-loader-circle"
          class="size-5 animate-spin"
        />
        Loading device detail…
      </div>

      <UAlert
        v-else-if="detailRes?.error || detailError"
        color="error"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="Could not load device detail"
        :description="detailRes?.error ?? String(detailError)"
      />

      <template v-else-if="detailRes?.data">
        <div class="space-y-4">
          <h2 class="font-semibold flex items-center gap-2">
            <UIcon
              name="i-lucide-cpu"
              class="size-4 text-primary"
            />
            {{ detailRes.data.device.name }} — data points
          </h2>

          <UAlert
            v-if="!detailRes.data.specification"
            color="warning"
            variant="subtle"
            icon="i-lucide-info"
            title="Specification endpoint unavailable on this plan/region"
            description="Showing live status DPs only — types and ranges omitted."
          />

          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-left text-xs uppercase tracking-wider text-muted border-b border-default">
                  <th class="py-2 pr-4">
                    DP code
                  </th>
                  <th class="py-2 pr-4">
                    Type
                  </th>
                  <th class="py-2 pr-4">
                    Current value
                  </th>
                  <th class="py-2">
                    Spec (range / scale / unit)
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in dpRows"
                  :key="row.code"
                  class="border-b border-default/50"
                >
                  <td class="py-2 pr-4 font-mono font-medium">
                    {{ row.code }}
                  </td>
                  <td class="py-2 pr-4 text-muted">
                    {{ row.type }}
                  </td>
                  <td class="py-2 pr-4 font-mono">
                    {{ row.value }}
                  </td>
                  <td class="py-2 font-mono text-xs text-muted break-all">
                    {{ row.spec }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <UAccordion
            :items="[{ label: 'Raw JSON (device + status + specification)', icon: 'i-lucide-braces', slot: 'raw' }]"
          >
            <template #raw>
              <pre class="text-xs overflow-x-auto p-4 bg-elevated rounded-lg">{{ rawDetailJson }}</pre>
            </template>
          </UAccordion>
        </div>
      </template>
    </template>
  </UContainer>
</template>
