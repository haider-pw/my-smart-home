# ⚡ Electricity Analytics — watt.appz.cc

Personal smart-home electricity analytics PWA. Polls a Tuya smart breaker and
metering smart plugs, stores unlimited history, and reports consumption and
cost in PKR (IESCO tariff, slab-aware) — with a load-shedding outage log that
distinguishes power cuts from internet cuts.

**Stack:** Nuxt 4 · Nuxt UI 4 · NuxtHub (`hub:db`, SQLite/Drizzle) · Vercel + Turso · Vitest

## Architecture

```
Smart Life devices ──→ Tuya Cloud (region eu)
                          │ signed HMAC-SHA256 requests
                          ▼
   external cron (5 min) ──→ POST /api/admin/poll ─┐
   dashboard visitors ─────→ pages + /api/* ───────┤ Vercel (watt.appz.cc)
   homelab relay (Phase 8) → POST /api/ingest ─────┘
                          │
                          ▼
              SQLite: local file (dev) / Turso (prod)
```

- **Energy accounting:** breaker `total_forward_energy` cumulative register
  (self-healing across gaps) + per-plug `add_ele` report-log events (exact).
  All writes idempotent via UNIQUE constraints — poller, backfill, and relay
  can overlap safely.
- **Timezone:** stored UTC, bucketed/displayed in `Asia/Karachi` (fixed UTC+5).
- **Outage classification:** register advanced while breaker offline →
  `internet`; frozen → `power` (load-shedding).

## Local development

```bash
pnpm install
cp .env.example .env       # fill NUXT_TUYA_CLIENT_ID / _SECRET (Tuya IoT console)
pnpm dev                   # migrations auto-apply to .data/db/sqlite.db
```

Useful dev/ops endpoints (all POST/GET with `x-admin-secret` header in prod;
open in local dev when `NUXT_INGEST_SECRET` is unset):

| Endpoint | Purpose |
|---|---|
| `POST /api/admin/poll` | one poll cycle (readings, energy, outage detection) |
| `POST /api/admin/backfill {days}` | import Tuya's ~7-day log history |
| `GET /api/admin/status` | table counts, devices, poller heartbeat |
| `/explorer` | live device DP inspector |

```bash
pnpm test        # vitest unit suites
pnpm lint        # eslint
pnpm typecheck   # vue-tsc
```

Schema changes: edit `server/db/schema.ts` → `pnpm drizzle-kit generate` →
migrations in `server/db/migrations` auto-apply on next dev start / build.

## Production (Vercel + Turso)

Environment variables on Vercel:

| Var | Purpose |
|---|---|
| `NUXT_TUYA_CLIENT_ID` / `NUXT_TUYA_CLIENT_SECRET` | Tuya cloud project credentials |
| `NUXT_TUYA_REGION` | `eu` |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | production database (libsql) |
| `NUXT_INGEST_SECRET` | shared secret for admin/ingest endpoints |
| `NUXT_AUTH_ALLOWED_IPS` / `NUXT_AUTH_APP_PIN` / `NUXT_AUTH_SESSION_SECRET` | access control (Phase 2) |

**Poller cron (required):** Vercel Hobby cron is daily-only, so a free external
scheduler (e.g. cron-job.org) must POST to
`https://watt.appz.cc/api/admin/poll` every 5 minutes with header
`x-admin-secret: <NUXT_INGEST_SECRET>`. Missed ticks are self-healing: the
breaker register carries totals across gaps, and `/api/admin/backfill`
recovers per-plug events and outage timestamps from Tuya's ~7-day logs.

## Security

- No secrets in code — everything via env vars; `.env` is git-ignored.
- Admin/ingest endpoints refuse to run in production without `NUXT_INGEST_SECRET`.
- App access control (IP allowlist + PIN) lands in Phase 2.
