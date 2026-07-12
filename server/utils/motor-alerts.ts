/**
 * Water-motor alerts — evaluated each poll cycle for switch-role devices.
 * Dedup keys make serverless re-runs safe (same pattern as alerts.ts).
 */
import { desc, eq, inArray, and } from 'drizzle-orm'
import { pktDayKey } from '../../shared/utils/pkt-time'
import * as schema from '../db/schema'
import { alertOnce } from './alerts'
import type { Db } from './db'
import type { TuyaDevice } from './tuya'
import { parseSwitchStatus } from './tuya-decode'

/** Longer than any normal tank fill — likely left on or a stuck float valve. */
const MOTOR_RUN_ALERT_MIN = 45
/** Past this it's not a forgotten fill — it's the relay parked always-on. */
const MOTOR_RUN_ALERT_MAX_MIN = 6 * 60

export async function evaluateMotorAlerts(db: Db, device: TuyaDevice, now: number): Promise<number> {
  let fired = 0

  // 1. Running too long — once per run session (keyed by the on-timestamp)
  const latest = await db.select()
    .from(schema.deviceEvents)
    .where(and(
      eq(schema.deviceEvents.deviceId, device.id),
      inArray(schema.deviceEvents.eventType, ['on', 'off'])
    ))
    .orderBy(desc(schema.deviceEvents.eventTime))
    .limit(1)
    .get()

  if (latest?.eventType === 'on') {
    const runMin = Math.round((now - latest.eventTime) / 60000)
    if (runMin >= MOTOR_RUN_ALERT_MIN && runMin <= MOTOR_RUN_ALERT_MAX_MIN) {
      if (await alertOnce(db, `motor-run:${device.id}:${latest.eventTime}`, 'motor-run',
        `🚰 ${device.name} running ${runMin} min`,
        `Longer than a normal fill (${MOTOR_RUN_ALERT_MIN} min) — worth checking it hasn't been left on.`)) {
        fired++
      }
    }
  }

  // 2. Fault code reported by the relay — once per code per PKT day
  const { fault } = parseSwitchStatus(device.status ?? [])
  if (fault !== null && fault !== 0) {
    if (await alertOnce(db, `motor-fault:${device.id}:${fault}:${pktDayKey(now)}`, 'motor-fault',
      `⚠ ${device.name} fault code ${fault}`,
      'The relay reported a fault — check the switch and motor.')) {
      fired++
    }
  }

  return fired
}
