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
    </template>
  </UContainer>
</template>
