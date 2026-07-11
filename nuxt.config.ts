// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui',
    '@nuxthub/core'
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
    // `wrangler secret` / NuxtHub env in production). NEVER hardcode values here.
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
    },
    ingest: {
      // Shared secret for /api/ingest (homelab relay) and admin endpoints
      secret: ''
    }
  },

  compatibilityDate: '2026-06-30',

  nitro: {
    experimental: {
      tasks: true
    }
    // No platform cron on Vercel Hobby — the 5-min poll is driven by an
    // external scheduler hitting POST /api/admin/poll (see README).
  },

  hub: {
    // sqlite everywhere: local file in dev, Turso (libsql) in production.
    //
    // WATT_DB_URL/WATT_DB_TOKEN (when set) pin production to ONE permanent
    // Turso database. This deliberately bypasses the Vercel↔Turso marketplace
    // integration's TURSO_* variables: those point at a FRESH database branch
    // on every production deployment, silently resetting all history.
    // An explicit connection wins over env-var detection inside NuxtHub.
    db: process.env.WATT_DB_URL
      ? {
          dialect: 'sqlite' as const,
          driver: 'libsql' as const,
          connection: {
            url: process.env.WATT_DB_URL,
            authToken: process.env.WATT_DB_TOKEN
          }
        }
      : 'sqlite'
  },

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  }
})
