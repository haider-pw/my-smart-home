/**
 * PITC web-bill fetcher — ASP.NET WebForms two-step dance:
 * GET the search page (cookies + __VIEWSTATE/__EVENTVALIDATION tokens),
 * then POST the reference number with the form's hidden fields.
 */
import { eq } from 'drizzle-orm'
import * as schema from '../db/schema'
import type { Db } from './db'
import { parseIescoBill, type ParsedBill } from './bill-parser'

const PITC_URL = 'https://bill.pitc.com.pk/iescobill'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'

function hiddenField(html: string, name: string): string {
  const m = html.match(new RegExp(`name="${name}"[^>]*value="([^"]*)"`))
  return m?.[1] ?? ''
}

export async function fetchBillHtml(referenceNo: string): Promise<string> {
  const getRes = await fetch(PITC_URL, { headers: { 'User-Agent': USER_AGENT } })
  if (!getRes.ok) {
    throw createError({ statusCode: 502, message: `PITC search page: HTTP ${getRes.status}` })
  }
  const page = await getRes.text()
  const cookies = getRes.headers.getSetCookie?.() ?? []
  const cookieHeader = cookies.map(c => c.split(';')[0]).join('; ')

  const body = new URLSearchParams({
    __EVENTTARGET: '',
    __EVENTARGUMENT: '',
    __LASTFOCUS: '',
    __VIEWSTATE: hiddenField(page, '__VIEWSTATE'),
    __VIEWSTATEGENERATOR: hiddenField(page, '__VIEWSTATEGENERATOR'),
    __EVENTVALIDATION: hiddenField(page, '__EVENTVALIDATION'),
    __RequestVerificationToken: hiddenField(page, '__RequestVerificationToken'),
    rbSearchByList: 'refno',
    searchTextBox: referenceNo,
    ruCodeTextBox: '',
    btnSearch: 'Search'
  })

  const postRes = await fetch(PITC_URL, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Referer': PITC_URL,
      ...(cookieHeader ? { Cookie: cookieHeader } : {})
    },
    body: body.toString()
  })
  if (!postRes.ok) {
    throw createError({ statusCode: 502, message: `PITC bill fetch: HTTP ${postRes.status}` })
  }
  return postRes.text()
}

export interface BillSyncSummary {
  billMonth: string | null
  inserted: number
  updated: number
  effectiveRateApplied: number | null
}

/** Fetch (from this server) then ingest. Fails where PITC geo-blocks the host. */
export async function syncBills(db: Db, referenceNo: string): Promise<BillSyncSummary> {
  const html = await fetchBillHtml(referenceNo)
  return syncBillsFromHtml(db, html)
}

/**
 * Parse + upsert from already-fetched bill HTML — the path used by the
 * homelab relay (PITC is unreachable from foreign datacenter IPs, so the
 * homelab fetches on its Pakistani connection and POSTs the HTML here).
 */
export async function syncBillsFromHtml(db: Db, html: string): Promise<BillSyncSummary> {
  const parsed: ParsedBill | null = parseIescoBill(html)
  if (!parsed) {
    throw createError({ statusCode: 502, message: 'PITC page did not contain a recognizable bill (invalid reference no?)' })
  }

  const now = Date.now()
  const summary: BillSyncSummary = { billMonth: parsed.billMonth, inserted: 0, updated: 0, effectiveRateApplied: null }

  // History rows first (units + amount only) — never overwrite a full record
  for (const row of parsed.history) {
    const existing = await db.select().from(schema.bills).where(eq(schema.bills.billMonth, row.billMonth)).get()
    if (existing) {
      continue
    }
    await db.insert(schema.bills).values({
      billMonth: row.billMonth,
      units: row.units,
      amountPkr: row.amountPkr,
      paymentPkr: row.paymentPkr,
      statusCode: row.statusCode,
      effectiveRatePkr: row.units > 0 && row.amountPkr > 0 ? Math.round((row.amountPkr / row.units) * 100) / 100 : null,
      source: 'history',
      fetchedAt: now
    }).onConflictDoNothing()
    summary.inserted++
  }

  // Current bill — full detail, upsert (amounts can change on rebill)
  if (parsed.units !== null && parsed.grandTotalPkr !== null) {
    const effectiveRate = parsed.units > 0 ? Math.round((parsed.grandTotalPkr / parsed.units) * 100) / 100 : null
    await db.insert(schema.bills).values({
      billMonth: parsed.billMonth,
      units: parsed.units,
      amountPkr: parsed.grandTotalPkr,
      paymentPkr: null,
      statusCode: null,
      readingDate: parsed.readingDate,
      issueDate: parsed.issueDate,
      dueDate: parsed.dueDate,
      payableAfterDuePkr: parsed.payableAfterDuePkr,
      fpaPkr: parsed.fpaPkr,
      effectiveRatePkr: effectiveRate,
      source: 'current',
      fetchedAt: now
    }).onConflictDoUpdate({
      target: schema.bills.billMonth,
      set: {
        units: parsed.units,
        amountPkr: parsed.grandTotalPkr,
        readingDate: parsed.readingDate,
        issueDate: parsed.issueDate,
        dueDate: parsed.dueDate,
        payableAfterDuePkr: parsed.payableAfterDuePkr,
        fpaPkr: parsed.fpaPkr,
        effectiveRatePkr: effectiveRate,
        source: 'current',
        fetchedAt: now
      }
    })
    summary.updated++

    // Auto-recalibrate the tariff's effective rate from the newest real bill
    if (effectiveRate && effectiveRate > 10) {
      const { getTariffConfig, TARIFF_SETTINGS_KEY } = await import('./tariff-settings')
      const { tariffToStored } = await import('../../shared/utils/tariff')
      const { config } = await getTariffConfig(db)
      if (config.effectiveRatePkr !== effectiveRate) {
        config.effectiveRatePkr = effectiveRate
        await db.insert(schema.settings)
          .values({ key: TARIFF_SETTINGS_KEY, value: tariffToStored(config), updatedAt: now })
          .onConflictDoUpdate({
            target: schema.settings.key,
            set: { value: tariffToStored(config), updatedAt: now }
          })
        summary.effectiveRateApplied = effectiveRate
      }
    }
  }

  return summary
}
