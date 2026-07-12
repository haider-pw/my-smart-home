/**
 * D1 (SQLite) schema — Drizzle ORM.
 *
 * Timestamps are stored as UTC epoch milliseconds (integer). All PKT
 * bucketing (hours/days in Asia/Karachi) happens via server/utils/pkt-time.ts.
 *
 * Idempotency is enforced by UNIQUE constraints, not application logic:
 * the poller, the backfill task, and the future homelab Pulsar relay can all
 * write the same fact without creating duplicates.
 */
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/** Devices discovered from the linked Smart Life account. */
export const devices = sqliteTable('devices', {
  /** Tuya device id */
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  category: text('category').notNull(),
  productName: text('product_name'),
  /** 'breaker' | 'plug' | 'switch' | 'other' — derived from Tuya category */
  role: text('role').notNull().default('other'),
  /** Only active devices are polled and reported on */
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(false),
  /** Nameplate power for non-metering switches — drives runtime→kWh estimation */
  ratedWatts: integer('rated_watts'),
  /** Last known online state — used for transition detection */
  lastOnline: integer('last_online', { mode: 'boolean' }),
  lastSeenAt: integer('last_seen_at'),
  createdAt: integer('created_at').notNull()
})

/** Raw instantaneous samples (V/A/W etc.) — 5-min cadence from the poller. */
export const readings = sqliteTable('readings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  deviceId: text('device_id').notNull(),
  /** UTC epoch ms of the sample */
  ts: integer('ts').notNull(),
  powerW: real('power_w'),
  voltageV: real('voltage_v'),
  currentA: real('current_a'),
  leakageMa: real('leakage_ma'),
  frequencyHz: real('frequency_hz'),
  /** 'poll' | 'relay' */
  source: text('source').notNull().default('poll')
}, table => [
  uniqueIndex('readings_device_ts_unique').on(table.deviceId, table.ts),
  index('readings_ts_idx').on(table.ts)
])

/** Cumulative kWh register snapshots (breaker total_forward_energy). */
export const registerSnapshots = sqliteTable('register_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  deviceId: text('device_id').notNull(),
  ts: integer('ts').notNull(),
  /** Absolute register value in kWh */
  registerKwh: real('register_kwh').notNull()
}, table => [
  uniqueIndex('register_snapshots_device_ts_unique').on(table.deviceId, table.ts)
])

/** Incremental energy events (plug add_ele reports, kWh per event). */
export const energyEvents = sqliteTable('energy_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  deviceId: text('device_id').notNull(),
  /** Tuya event_time — UTC epoch ms, unique per device */
  eventTime: integer('event_time').notNull(),
  kwh: real('kwh').notNull()
}, table => [
  uniqueIndex('energy_events_device_time_unique').on(table.deviceId, table.eventTime)
])

/** Hourly energy rollup — what every report queries. */
export const energyHourly = sqliteTable('energy_hourly', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  deviceId: text('device_id').notNull(),
  /** UTC epoch ms of the PKT hour start */
  hourStart: integer('hour_start').notNull(),
  kwh: real('kwh').notNull().default(0),
  /** 'register' | 'events' | 'backfill' */
  source: text('source').notNull().default('register')
}, table => [
  uniqueIndex('energy_hourly_device_hour_unique').on(table.deviceId, table.hourStart),
  index('energy_hourly_hour_idx').on(table.hourStart)
])

/** Daily energy — only for coarse historical imports where hourly is unknown. */
export const energyDaily = sqliteTable('energy_daily', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  deviceId: text('device_id').notNull(),
  /** PKT calendar day, 'YYYY-MM-DD' */
  day: text('day').notNull(),
  kwh: real('kwh').notNull(),
  /** 'backfill_daily' | 'backfill_monthly' */
  source: text('source').notNull()
}, table => [
  uniqueIndex('energy_daily_device_day_unique').on(table.deviceId, table.day)
])

/**
 * State transitions: online/offline (connectivity), on/off (relay), and
 * sig-on/sig-off (synthetic motor runs inferred from power signatures).
 */
export const deviceEvents = sqliteTable('device_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  deviceId: text('device_id').notNull(),
  /** 'online' | 'offline' | 'on' | 'off' | 'sig-on' | 'sig-off' */
  eventType: text('event_type').notNull(),
  eventTime: integer('event_time').notNull()
}, table => [
  uniqueIndex('device_events_unique').on(table.deviceId, table.eventType, table.eventTime),
  index('device_events_time_idx').on(table.eventTime)
])

/** Derived outage windows (from breaker offline periods). */
export const outages = sqliteTable('outages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  startTs: integer('start_ts').notNull(),
  endTs: integer('end_ts'),
  durationMin: real('duration_min'),
  /** 'power' (load-shedding) | 'internet' | 'unknown' — via register-advance heuristic */
  kind: text('kind').notNull().default('unknown'),
  /** kWh the register advanced during the gap — the classification evidence */
  registerDeltaKwh: real('register_delta_kwh')
}, table => [
  uniqueIndex('outages_start_unique').on(table.startTs)
])

/** Alert history (evaluation lands in Phase 7). */
export const alerts = sqliteTable('alerts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type').notNull(),
  ts: integer('ts').notNull(),
  payload: text('payload', { mode: 'json' }),
  delivered: integer('delivered', { mode: 'boolean' }).notNull().default(false)
})

/** Web Push subscriptions (Phase 7). */
export const pushSubscriptions = sqliteTable('push_subscriptions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  endpoint: text('endpoint').notNull().unique(),
  keys: text('keys', { mode: 'json' }).notNull(),
  createdAt: integer('created_at').notNull()
})

/** App settings: tariff config, budget bands, billing anchor day, breaker rating… */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
  updatedAt: integer('updated_at').notNull()
})

/** PIN attempt log for rate limiting (Phase 2). */
export const authAttempts = sqliteTable('auth_attempts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  ip: text('ip').notNull(),
  ts: integer('ts').notNull(),
  success: integer('success', { mode: 'boolean' }).notNull()
}, table => [
  index('auth_attempts_ip_ts_idx').on(table.ip, table.ts)
])

/** Poller bookkeeping: log cursors per device, last successful poll, token health. */
export const syncState = sqliteTable('sync_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull()
})

/**
 * Official IESCO bills scraped from the PITC web bill (current bill full
 * detail; history rows carry units + amount only). Enables billed-vs-measured
 * auditing and monthly effective-rate recalibration.
 */
export const bills = sqliteTable('bills', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** Normalized 'YYYY-MM' */
  billMonth: text('bill_month').notNull().unique(),
  units: integer('units'),
  amountPkr: real('amount_pkr'),
  paymentPkr: real('payment_pkr'),
  statusCode: text('status_code'),
  /** Full-detail fields — present only for the current scraped bill */
  readingDate: text('reading_date'),
  issueDate: text('issue_date'),
  dueDate: text('due_date'),
  payableAfterDuePkr: real('payable_after_due_pkr'),
  fpaPkr: real('fpa_pkr'),
  /** amount ÷ units, when both known */
  effectiveRatePkr: real('effective_rate_pkr'),
  /** 'current' | 'history' — how this row was obtained */
  source: text('source').notNull().default('history'),
  /** R2 object key of the archived original document (bills/YYYY-MM.html) */
  archiveKey: text('archive_key'),
  archiveContentType: text('archive_content_type'),
  fetchedAt: integer('fetched_at').notNull()
})
