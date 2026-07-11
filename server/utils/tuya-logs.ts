/**
 * Tuya device-log endpoints — the history sources confirmed working in the
 * Phase 1 probe (the statistics service is not subscribed on this project,
 * but IoT Core report-logs and classic device logs are available).
 */
import { tuyaGet } from './tuya'

export interface ReportLogEntry {
  code: string
  /** UTC epoch ms */
  event_time: number
  value: string
}

interface ReportLogsPage {
  device_id: string
  has_more: boolean
  last_row_key?: string
  logs: ReportLogEntry[]
}

const MAX_PAGES = 20
const PAGE_SIZE = 100

/**
 * DP report history (e.g. add_ele increments, total_forward_energy values).
 * Pages through IoT Core report-logs; capped to keep a poll cycle bounded.
 */
export async function fetchReportLogs(
  deviceId: string,
  codes: string,
  startTime: number,
  endTime: number
): Promise<ReportLogEntry[]> {
  const all: ReportLogEntry[] = []
  let lastRowKey: string | undefined

  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await tuyaGet<ReportLogsPage>(`/v2.0/cloud/thing/${deviceId}/report-logs`, {
      codes,
      start_time: startTime,
      end_time: endTime,
      size: PAGE_SIZE,
      ...(lastRowKey ? { last_row_key: lastRowKey } : {})
    })
    all.push(...(res.logs ?? []))
    if (!res.has_more || !res.last_row_key) {
      break
    }
    lastRowKey = res.last_row_key
  }
  return all
}

export interface ConnectivityEvent {
  eventType: 'online' | 'offline'
  /** UTC epoch ms */
  eventTime: number
}

interface ClassicLogEntry {
  event_id: number
  event_time: number
  [key: string]: unknown
}

interface ClassicLogsPage {
  device_id: string
  has_next: boolean
  current_row_key?: string
  next_row_key?: string
  logs: ClassicLogEntry[]
}

const EVENT_ONLINE = 1
const EVENT_OFFLINE = 2

/**
 * Connectivity history from the classic logs endpoint (type 1 = online,
 * 2 = offline) — lets the outage log recover transitions the poller missed.
 */
export async function fetchConnectivityEvents(
  deviceId: string,
  startTime: number,
  endTime: number
): Promise<ConnectivityEvent[]> {
  const all: ConnectivityEvent[] = []
  let rowKey: string | undefined

  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await tuyaGet<ClassicLogsPage>(`/v1.0/devices/${deviceId}/logs`, {
      type: `${EVENT_ONLINE},${EVENT_OFFLINE}`,
      start_time: startTime,
      end_time: endTime,
      size: PAGE_SIZE,
      ...(rowKey ? { start_row_key: rowKey } : {})
    })
    for (const log of res.logs ?? []) {
      if (log.event_id === EVENT_ONLINE || log.event_id === EVENT_OFFLINE) {
        all.push({
          eventType: log.event_id === EVENT_ONLINE ? 'online' : 'offline',
          eventTime: log.event_time
        })
      }
    }
    const nextKey = res.next_row_key ?? res.current_row_key
    if (!res.has_next || !nextKey || nextKey === rowKey) {
      break
    }
    rowKey = nextKey
  }
  return all.sort((a, b) => a.eventTime - b.eventTime)
}
