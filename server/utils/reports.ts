/**
 * Read-side aggregation over energy_hourly — the queries every report view
 * shares. All windows are [from, to) in UTC epoch ms; bucketing is PKT.
 */
import { and, eq, gte, lt, sql } from 'drizzle-orm'
import { pktDayKey, pktHourOfDay } from '../../shared/utils/pkt-time'
import * as schema from '../db/schema'
import type { Db } from './db'

export interface DeviceEnergy {
  deviceId: string
  kwh: number
}

/** Total kWh per device in the window. */
export async function energyByDevice(db: Db, from: number, to: number): Promise<DeviceEnergy[]> {
  const rows = await db.select({
    deviceId: schema.energyHourly.deviceId,
    kwh: sql<number>`sum(${schema.energyHourly.kwh})`
  })
    .from(schema.energyHourly)
    .where(and(gte(schema.energyHourly.hourStart, from), lt(schema.energyHourly.hourStart, to)))
    .groupBy(schema.energyHourly.deviceId)
    .all()
  return rows.map(r => ({ deviceId: r.deviceId, kwh: r.kwh ?? 0 }))
}

export interface DailyPoint {
  /** PKT day 'YYYY-MM-DD' */
  day: string
  kwh: number
}

/** Daily totals (PKT days) for one device or all devices summed. */
export async function dailySeries(db: Db, from: number, to: number, deviceId?: string): Promise<DailyPoint[]> {
  const where = deviceId
    ? and(gte(schema.energyHourly.hourStart, from), lt(schema.energyHourly.hourStart, to), eq(schema.energyHourly.deviceId, deviceId))
    : and(gte(schema.energyHourly.hourStart, from), lt(schema.energyHourly.hourStart, to))

  const rows = await db.select({
    hourStart: schema.energyHourly.hourStart,
    kwh: schema.energyHourly.kwh
  }).from(schema.energyHourly).where(where).all()

  const byDay = new Map<string, number>()
  for (const row of rows) {
    const key = pktDayKey(row.hourStart)
    byDay.set(key, (byDay.get(key) ?? 0) + row.kwh)
  }
  return Array.from(byDay.entries())
    .map(([day, kwh]) => ({ day, kwh }))
    .sort((a, b) => a.day.localeCompare(b.day))
}

export interface HourlyPoint {
  /** UTC epoch ms of the PKT hour start */
  hourStart: number
  kwh: number
}

/** Hour-resolution totals for one device or all summed. */
export async function hourlySeries(db: Db, from: number, to: number, deviceId?: string): Promise<HourlyPoint[]> {
  const where = deviceId
    ? and(gte(schema.energyHourly.hourStart, from), lt(schema.energyHourly.hourStart, to), eq(schema.energyHourly.deviceId, deviceId))
    : and(gte(schema.energyHourly.hourStart, from), lt(schema.energyHourly.hourStart, to))

  const rows = await db.select({
    hourStart: schema.energyHourly.hourStart,
    kwh: sql<number>`sum(${schema.energyHourly.kwh})`
  })
    .from(schema.energyHourly)
    .where(where)
    .groupBy(schema.energyHourly.hourStart)
    .orderBy(schema.energyHourly.hourStart)
    .all()
  return rows.map(r => ({ hourStart: r.hourStart, kwh: r.kwh ?? 0 }))
}

export interface DailyDeviceRow {
  /** PKT day 'YYYY-MM-DD' */
  day: string
  deviceId: string
  kwh: number
}

/** Daily totals per device (PKT days) in one pass — feeds the cost page. */
export async function dailyByDevice(db: Db, from: number, to: number): Promise<DailyDeviceRow[]> {
  const rows = await db.select({
    hourStart: schema.energyHourly.hourStart,
    deviceId: schema.energyHourly.deviceId,
    kwh: schema.energyHourly.kwh
  })
    .from(schema.energyHourly)
    .where(and(gte(schema.energyHourly.hourStart, from), lt(schema.energyHourly.hourStart, to)))
    .all()

  const byKey = new Map<string, DailyDeviceRow>()
  for (const row of rows) {
    const day = pktDayKey(row.hourStart)
    const key = `${day}|${row.deviceId}`
    const entry = byKey.get(key)
    if (entry) {
      entry.kwh += row.kwh
    } else {
      byKey.set(key, { day, deviceId: row.deviceId, kwh: row.kwh })
    }
  }
  return Array.from(byKey.values()).sort((a, b) => a.day.localeCompare(b.day))
}

export interface HeatmapCell {
  day: string
  hour: number
  kwh: number
}

/** day × hour matrix (PKT) for the heatmap. */
export async function heatmapMatrix(db: Db, from: number, to: number): Promise<HeatmapCell[]> {
  const points = await hourlySeries(db, from, to)
  return points.map(p => ({
    day: pktDayKey(p.hourStart),
    hour: pktHourOfDay(p.hourStart),
    kwh: p.kwh
  }))
}

/** kWh consumed inside the peak window (PKT hours) per device. */
export async function peakShareByDevice(
  db: Db,
  from: number,
  to: number,
  peakHours: [number, number]
): Promise<Map<string, { total: number, peak: number }>> {
  const rows = await db.select({
    deviceId: schema.energyHourly.deviceId,
    hourStart: schema.energyHourly.hourStart,
    kwh: schema.energyHourly.kwh
  })
    .from(schema.energyHourly)
    .where(and(gte(schema.energyHourly.hourStart, from), lt(schema.energyHourly.hourStart, to)))
    .all()

  const result = new Map<string, { total: number, peak: number }>()
  for (const row of rows) {
    const entry = result.get(row.deviceId) ?? { total: 0, peak: 0 }
    entry.total += row.kwh
    const hour = pktHourOfDay(row.hourStart)
    if (hour >= peakHours[0] && hour < peakHours[1]) {
      entry.peak += row.kwh
    }
    result.set(row.deviceId, entry)
  }
  return result
}
