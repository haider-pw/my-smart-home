// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui',
    '@nuxthub/core',
    '@vite-pwa/nuxt'
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
    },
    bill: {
      // 14-digit IESCO reference number for the PITC web-bill scraper
      referenceNo: ''
    },
    r2: {
      // R2 bucket for bill archives (S3 API credentials)
      accountId: '',
      accessKeyId: '',
      secretAccessKey: '',
      bucket: ''
    },
    vapid: {
      // Web Push signing (generate with `npx web-push generate-vapid-keys`)
      privateKey: '',
      subject: ''
    },
    public: {
      vapidPublicKey: ''
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
  },

  pwa: {
    strategies: 'injectManifest',
    srcDir: 'sw',
    filename: 'sw.ts',
    registerType: 'autoUpdate',
    injectRegister: 'auto',
    manifest: {
      name: 'Watt — Electricity Analytics',
      short_name: 'Watt',
      description: 'Personal smart-home electricity analytics',
      start_url: '/',
      display: 'standalone',
      background_color: '#070a10',
      theme_color: '#070a10',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
      ]
    },
    injectManifest: {
      globPatterns: ['**/*.{js,css,png,svg,ico}']
    },
    devOptions: { enabled: false }
  }
})
