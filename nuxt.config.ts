// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui'
  ],

  devtools: {
    enabled: true
  },

  css: ['~/assets/css/main.css'],

  colorMode: {
    preference: 'dark',
    fallback: 'dark'
  },

  runtimeConfig: {
    // Server-only secrets — set via NUXT_* environment variables (.env locally,
    // `wrangler secret` in production). NEVER hardcode values here.
    tuya: {
      clientId: '',
      clientSecret: '',
      // Optional: in | eu | us | cn — leave empty to auto-detect the data center
      region: ''
    },
    auth: {
      // Comma-separated IPs/CIDRs that bypass the PIN page (Phase 2)
      allowedIps: '',
      appPin: '',
      sessionSecret: ''
    }
  },

  compatibilityDate: '2026-06-30',

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  }
})
