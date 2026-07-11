<script setup lang="ts">
import type { TariffConfig } from '../../shared/utils/tariff'

interface ApiEnvelope<T> {
  success: boolean
  data: T | null
  error: string | null
}

useSeoMeta({ title: 'Settings — Electricity Analytics' })

const toast = useToast()
const saving = ref(false)

const { data: res, refresh } = await useFetch<ApiEnvelope<{ config: TariffConfig, isDefault: boolean }>>(
  '/api/settings/tariff',
  { retry: 2, retryDelay: 1500 }
)

// ── Push notifications ───────────────────────────────────────────────────
const push = usePush()
onMounted(() => push.refresh())

async function togglePush() {
  if (push.subscribed.value) {
    await push.unsubscribe()
    toast.add({ title: 'Push disabled on this device', color: 'neutral' })
  } else {
    const ok = await push.subscribe()
    toast.add(ok
      ? { title: 'Push enabled', description: 'Slab, outage, and spike alerts will arrive on this device.', color: 'success' }
      : { title: 'Permission denied', description: 'Allow notifications in the browser settings.', color: 'warning' })
  }
}

const testingPush = ref(false)
async function sendTestPush() {
  testingPush.value = true
  try {
    const r = await $fetch<ApiEnvelope<{ sent: number }>>('/api/push/test', { method: 'POST' })
    toast.add({ title: `Test sent to ${r.data?.sent ?? 0} device(s)`, color: 'success' })
  } finally {
    testingPush.value = false
  }
}

interface AlertRow { id: number, type: string, ts: number, payload: { title?: string, body?: string } | null }
const { data: alertsRes } = await useFetch<ApiEnvelope<{ alerts: AlertRow[] }>>('/api/reports/alerts', { lazy: true })

interface BackupStatus { lastAt: number | null, lastRows: number | null, lastBytes: number | null, count: number }
const { data: backupRes } = await useFetch<ApiEnvelope<BackupStatus>>('/api/reports/backup-status', { lazy: true })
const backup = computed(() => backupRes.value?.data ?? null)
function ago(ts: number): string {
  const mins = Math.round((Date.now() - ts) / 60000)
  if (mins < 60) {
    return `${mins} min ago`
  }
  if (mins < 1440) {
    return `${Math.round(mins / 60)} h ago`
  }
  return `${Math.round(mins / 1440)} d ago`
}

// Editable copy (deep) — saved back as a whole
const form = ref<TariffConfig | null>(null)
watchEffect(() => {
  if (res.value?.data && !form.value) {
    form.value = JSON.parse(JSON.stringify(res.value.data.config)) as TariffConfig
  }
})

// Bill helper: total ÷ units → effective rate
const billTotal = ref<number | null>(null)
const billUnits = ref<number | null>(null)
const computedRate = computed(() =>
  billTotal.value && billUnits.value && billUnits.value > 0
    ? Math.round((billTotal.value / billUnits.value) * 100) / 100
    : null
)

function applyComputedRate() {
  if (form.value && computedRate.value) {
    form.value.effectiveRatePkr = computedRate.value
  }
}

async function save() {
  if (!form.value || saving.value) {
    return
  }
  saving.value = true
  try {
    await $fetch('/api/settings/tariff', { method: 'PUT', body: form.value })
    toast.add({ title: 'Settings saved', icon: 'i-lucide-check', color: 'success' })
    await refresh()
  } catch (error: unknown) {
    const err = error as { data?: { error?: string } }
    toast.add({ title: 'Save failed', description: err.data?.error ?? 'Unknown error', color: 'error' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UContainer class="py-6 space-y-4 max-w-3xl">
    <div>
      <h1 class="text-sm font-semibold flex items-center gap-2">
        <UIcon
          name="i-lucide-settings-2"
          class="size-4 text-primary"
        />
        Settings — tariff & budget
      </h1>
      <p class="microlabel text-dimmed mt-1">
        Calibrate the money math against your real IESCO bill
      </p>
    </div>

    <UAlert
      v-if="res?.data?.isDefault"
      color="info"
      variant="subtle"
      icon="i-lucide-receipt"
      description="Currently running on IESCO-style defaults. Enter the three numbers from any recent bill below — everything else can stay as-is."
    />

    <template v-if="form">
      <!-- The three numbers that matter -->
      <div class="panel p-5 space-y-4">
        <h2 class="text-sm font-semibold">
          Your real bill (recommended)
        </h2>
        <div class="grid sm:grid-cols-3 gap-3">
          <UFormField
            label="Bill total (PKR)"
            help="Total payable"
          >
            <UInput
              v-model.number="billTotal"
              type="number"
              placeholder="e.g. 28450"
            />
          </UFormField>
          <UFormField
            label="Units billed"
            help="kWh on the bill"
          >
            <UInput
              v-model.number="billUnits"
              type="number"
              placeholder="e.g. 520"
            />
          </UFormField>
          <UFormField
            label="→ Effective rate"
            :help="computedRate ? `Rs ${computedRate}/unit` : 'auto-computed'"
          >
            <UButton
              :disabled="!computedRate"
              variant="soft"
              block
              icon="i-lucide-calculator"
              :label="computedRate ? `Use Rs ${computedRate}` : 'Enter both'"
              @click="applyComputedRate"
            />
          </UFormField>
        </div>
        <div class="grid sm:grid-cols-2 gap-3">
          <UFormField
            label="Effective rate (PKR/unit)"
            help="Used for all cost estimates when set — captures every tax implicitly"
          >
            <UInput
              v-model.number="form.effectiveRatePkr"
              type="number"
              step="0.01"
              placeholder="empty = slab model"
            />
          </UFormField>
          <UFormField
            label="Meter-reading day"
            help="Day of month your billing cycle starts (on the bill)"
          >
            <UInput
              v-model.number="form.cycleAnchorDay"
              type="number"
              min="1"
              max="28"
            />
          </UFormField>
        </div>
      </div>

      <!-- Budget -->
      <div class="panel p-5 space-y-4">
        <h2 class="text-sm font-semibold">
          Monthly budget bands
        </h2>
        <div class="grid sm:grid-cols-2 gap-3">
          <UFormField label="Green ceiling (PKR)">
            <UInput
              v-model.number="form.budget.green"
              type="number"
              step="1000"
            />
          </UFormField>
          <UFormField label="Red line (PKR)">
            <UInput
              v-model.number="form.budget.red"
              type="number"
              step="1000"
            />
          </UFormField>
        </div>
      </div>

      <!-- Meter -->
      <div class="panel p-5 space-y-4">
        <h2 class="text-sm font-semibold">
          Meter & consumer category
        </h2>
        <div class="grid sm:grid-cols-2 gap-3">
          <UFormField label="Meter type">
            <USelect
              v-model="form.meterType"
              :items="[
                { label: 'Single-phase (slab billing)', value: 'single-phase' },
                { label: '3-phase TOU (peak/off-peak)', value: 'tou' }
              ]"
            />
          </UFormField>
          <UFormField
            label="Category"
            help="Protected = ≤200 units for 6 consecutive months"
          >
            <USelect
              v-model="form.category"
              :items="[
                { label: 'Unprotected (most homes with ACs)', value: 'unprotected' },
                { label: 'Protected', value: 'protected' }
              ]"
            />
          </UFormField>
        </div>
      </div>

      <!-- Advanced: surcharges -->
      <UAccordion
        :items="[{ label: 'Advanced — surcharges & slab rates (defaults are fine until reconciling)', icon: 'i-lucide-sliders-horizontal', slot: 'advanced' }]"
      >
        <template #advanced>
          <div class="space-y-4 p-1">
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <UFormField label="FPA (Rs/unit)">
                <UInput
                  v-model.number="form.surcharges.fpaPerUnit"
                  type="number"
                  step="0.01"
                />
              </UFormField>
              <UFormField label="QTA (Rs/unit)">
                <UInput
                  v-model.number="form.surcharges.qtaPerUnit"
                  type="number"
                  step="0.01"
                />
              </UFormField>
              <UFormField label="Other (Rs/unit)">
                <UInput
                  v-model.number="form.surcharges.otherPerUnit"
                  type="number"
                  step="0.01"
                />
              </UFormField>
              <UFormField label="Duty (fraction)">
                <UInput
                  v-model.number="form.surcharges.electricityDutyPct"
                  type="number"
                  step="0.001"
                />
              </UFormField>
              <UFormField label="GST (fraction)">
                <UInput
                  v-model.number="form.surcharges.gstPct"
                  type="number"
                  step="0.01"
                />
              </UFormField>
              <UFormField label="PTV fee (Rs)">
                <UInput
                  v-model.number="form.surcharges.tvFee"
                  type="number"
                />
              </UFormField>
            </div>
            <div>
              <p class="microlabel text-dimmed mb-2">
                Slab rates — {{ form.category }} (PKR/unit)
              </p>
              <div class="grid grid-cols-4 sm:grid-cols-8 gap-2">
                <UInput
                  v-for="(slab, i) in form.slabs[form.category]"
                  :key="i"
                  v-model.number="slab.rate"
                  type="number"
                  step="0.01"
                  size="sm"
                />
              </div>
            </div>
          </div>
        </template>
      </UAccordion>

      <div class="flex justify-end gap-3">
        <UButton
          :loading="saving"
          icon="i-lucide-save"
          label="Save settings"
          size="lg"
          @click="save"
        />
      </div>

      <!-- Notifications -->
      <div class="panel p-5 space-y-4">
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 class="text-sm font-semibold">
              Push notifications
            </h2>
            <p class="microlabel text-dimmed mt-0.5">
              slab warnings · outage/restore · usage spikes · projection over budget
            </p>
          </div>
          <div class="flex gap-2">
            <UButton
              v-if="push.supported.value"
              :label="push.subscribed.value ? 'Disable on this device' : 'Enable on this device'"
              :color="push.subscribed.value ? 'neutral' : 'primary'"
              :variant="push.subscribed.value ? 'soft' : 'solid'"
              :loading="push.busy.value"
              icon="i-lucide-bell"
              @click="togglePush"
            />
            <UButton
              v-if="push.subscribed.value"
              label="Send test"
              variant="ghost"
              color="neutral"
              :loading="testingPush"
              @click="sendTestPush"
            />
          </div>
        </div>
        <p
          v-if="!push.supported.value"
          class="text-xs text-muted"
        >
          Push requires the installed PWA or a modern browser, plus VAPID keys configured on the server.
        </p>
        <div v-if="(alertsRes?.data?.alerts.length ?? 0) > 0">
          <p class="microlabel text-dimmed mb-2">
            Recent alerts
          </p>
          <div class="flex flex-col gap-1.5">
            <div
              v-for="alert in alertsRes?.data?.alerts ?? []"
              :key="alert.id"
              class="flex items-baseline gap-3 text-xs rounded-lg bg-elevated/40 border border-default/50 px-3 py-2"
            >
              <span class="num text-dimmed whitespace-nowrap">{{ new Date(alert.ts + 5 * 3600 * 1000).toISOString().slice(5, 16).replace('T', ' ') }}</span>
              <span class="font-medium">{{ alert.payload?.title ?? alert.type }}</span>
              <span class="text-muted truncate">{{ alert.payload?.body }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Backups -->
      <div class="panel p-5">
        <div class="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 class="text-sm font-semibold">
              Database backups
            </h2>
            <p class="microlabel text-dimmed mt-0.5">
              nightly gzipped snapshot to R2 · 14 daily + 12 monthly retained
            </p>
          </div>
          <UBadge
            v-if="backup?.lastAt"
            color="success"
            variant="subtle"
          >
            <UIcon
              name="i-lucide-shield-check"
              class="size-3 mr-1"
            />
            {{ ago(backup.lastAt) }}
          </UBadge>
          <UBadge
            v-else
            color="warning"
            variant="subtle"
          >
            no backup yet
          </UBadge>
        </div>
        <p
          v-if="backup?.lastAt"
          class="text-xs text-muted mt-3 num"
        >
          Last: {{ backup.lastRows?.toLocaleString() }} rows · {{ Math.round((backup.lastBytes ?? 0) / 1024) }} KB · {{ backup.count }} snapshot{{ backup.count === 1 ? '' : 's' }} stored
        </p>
        <p
          v-else
          class="text-xs text-muted mt-3"
        >
          Runs automatically once the nightly job is scheduled. Your history is the only irreplaceable data — Tuya keeps just 7 days.
        </p>
      </div>
    </template>
  </UContainer>
</template>
