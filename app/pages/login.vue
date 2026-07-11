<script setup lang="ts">
interface AuthContext {
  ip: string
  configured: boolean
  ipAllowed: boolean
  authed: boolean
}

interface ApiEnvelope<T> {
  success: boolean
  data: T | null
  error: string | null
}

useSeoMeta({
  title: 'Sign in — Electricity Analytics'
})

const pin = ref('')
const errorMsg = ref('')
const submitting = ref(false)

const { data: ctxRes } = await useFetch<ApiEnvelope<AuthContext>>('/api/auth/context', { lazy: true })

// Already authed or allowlisted? Straight to the dashboard.
watchEffect(() => {
  const ctx = ctxRes.value?.data
  if (ctx && (ctx.authed || ctx.ipAllowed || !ctx.configured)) {
    navigateTo('/', { replace: true })
  }
})

async function submit() {
  if (!pin.value.trim() || submitting.value) {
    return
  }
  submitting.value = true
  errorMsg.value = ''
  try {
    await $fetch('/api/auth/login', { method: 'POST', body: { pin: pin.value.trim() } })
    await navigateTo('/', { replace: true })
  } catch (error: unknown) {
    const err = error as { data?: { error?: string }, statusCode?: number }
    errorMsg.value = err.data?.error ?? 'Sign-in failed — try again'
    pin.value = ''
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="min-h-[78vh] grid place-items-center px-4">
    <form
      class="w-full max-w-sm rounded-2xl border border-default bg-elevated/60 p-8 shadow-xl"
      @submit.prevent="submit"
    >
      <div class="flex items-center gap-3 mb-5">
        <div class="grid size-11 place-items-center rounded-xl bg-primary/10 ring-1 ring-primary/30">
          <UIcon
            name="i-lucide-zap"
            class="size-5 text-primary"
          />
        </div>
        <div>
          <p class="font-bold leading-tight">
            Electricity Analytics
          </p>
          <p class="text-[11px] uppercase tracking-widest text-muted">
            Private console
          </p>
        </div>
      </div>

      <UAlert
        v-if="ctxRes?.data && !ctxRes.data.ipAllowed"
        color="warning"
        variant="subtle"
        icon="i-lucide-shield-alert"
        class="mb-5"
        :description="`Request from an unrecognized IP ${ctxRes.data.ip} — enter the PIN to continue.`"
      />

      <label
        for="pin"
        class="block text-[11px] uppercase tracking-widest text-muted mb-2"
      >PIN</label>
      <UInput
        id="pin"
        v-model="pin"
        type="password"
        placeholder="••••••"
        autocomplete="current-password"
        size="lg"
        class="w-full mb-4"
        autofocus
      />

      <p
        v-if="errorMsg"
        class="text-sm text-error mb-3"
      >
        {{ errorMsg }}
      </p>

      <UButton
        type="submit"
        block
        size="lg"
        :loading="submitting"
        label="Sign in"
      />

      <p class="text-xs text-muted text-center mt-5 leading-relaxed">
        Personal deployment — no self-registration.<br>
        Allowlisted IPs skip this page automatically.
      </p>
    </form>
  </div>
</template>
