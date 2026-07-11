/**
 * IESCO/PITC web-bill HTML parser — pure functions, no Nuxt dependencies.
 *
 * The PITC page is label-anchored bilingual markup; we flatten tags to a
 * pipe-separated token stream and read values relative to English labels,
 * which survives styling changes far better than CSS selectors.
 */

export interface ParsedBillHistoryRow {
  /** 'YYYY-MM' */
  billMonth: string
  statusCode: string | null
  units: number
  amountPkr: number
  paymentPkr: number
}

export interface ParsedBill {
  billMonth: string
  units: number | null
  grandTotalPkr: number | null
  payableAfterDuePkr: number | null
  fpaPkr: number | null
  readingDate: string | null
  issueDate: string | null
  dueDate: string | null
  history: ParsedBillHistoryRow[]
}

const MONTHS: Record<string, string> = {
  JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
  JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12'
}

/** 'JUN 26' or 'Jun26' → '2026-06'; null when unrecognizable. */
export function normalizeBillMonth(raw: string): string | null {
  const m = raw.trim().toUpperCase().match(/^([A-Z]{3})\s*(\d{2})$/)
  if (!m || !MONTHS[m[1]!]) {
    return null
  }
  return `20${m[2]}-${MONTHS[m[1]!]}`
}

/** Flattens HTML to a pipe-separated token stream. */
export function tokenize(html: string): string[] {
  const noScript = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  const piped = noScript.replace(/<[^>]+>/g, '|')
  return piped
    .split('|')
    .map(t => t.replace(/\s+/g, ' ').trim())
    .filter(t => t.length > 0)
}

function toNumber(token: string | undefined): number | null {
  if (!token) {
    return null
  }
  const n = Number(token.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

/** First numeric token within `lookahead` tokens after the label. */
function numberAfter(tokens: string[], label: string, lookahead = 6): number | null {
  const i = tokens.findIndex(t => t.toUpperCase() === label.toUpperCase())
  if (i < 0) {
    return null
  }
  for (let j = i + 1; j <= i + lookahead && j < tokens.length; j++) {
    const n = toNumber(tokens[j])
    if (n !== null) {
      return n
    }
  }
  return null
}

/** First 'DD MMM YY'-shaped token within `lookahead` tokens after the label. */
function dateAfter(tokens: string[], label: string, lookahead = 6): string | null {
  // includes(), not equality: labels may carry entity prefixes (e.g. '&#9888; DUE DATE')
  const i = tokens.findIndex(t => t.toUpperCase().includes(label.toUpperCase()))
  if (i < 0) {
    return null
  }
  for (let j = i + 1; j <= i + lookahead && j < tokens.length; j++) {
    if (/^\d{1,2}\s[A-Z]{3}\s\d{2}$/i.test(tokens[j]!)) {
      return tokens[j]!
    }
  }
  return null
}

function monthTokenAfter(tokens: string[], label: string, lookahead = 6): string | null {
  const i = tokens.findIndex(t => t.toUpperCase() === label.toUpperCase())
  if (i < 0) {
    return null
  }
  for (let j = i + 1; j <= i + lookahead && j < tokens.length; j++) {
    const norm = normalizeBillMonth(tokens[j]!)
    if (norm) {
      return norm
    }
  }
  return null
}

/** History rows look like: <MonYY> [STATUS] <units> <amount> <payment> */
export function parseHistory(tokens: string[]): ParsedBillHistoryRow[] {
  const rows: ParsedBillHistoryRow[] = []
  const start = tokens.findIndex(t => t.toUpperCase() === 'BILL HISTORY')
  if (start < 0) {
    return rows
  }
  for (let i = start; i < tokens.length; i++) {
    const month = normalizeBillMonth(tokens[i]!)
    if (!month) {
      continue
    }
    // status token is optional (alphanumeric, not a number)
    let j = i + 1
    let status: string | null = null
    if (tokens[j] && toNumber(tokens[j]) === null && /^[A-Z]{1,4}$/i.test(tokens[j]!)) {
      status = tokens[j]!
      j++
    }
    const units = toNumber(tokens[j])
    const amount = toNumber(tokens[j + 1])
    const payment = toNumber(tokens[j + 2])
    if (units !== null && amount !== null) {
      rows.push({ billMonth: month, statusCode: status, units, amountPkr: amount, paymentPkr: payment ?? 0 })
      i = j + 2
    }
  }
  return rows
}

export function parseIescoBill(html: string): ParsedBill | null {
  const tokens = tokenize(html)
  const billMonth = monthTokenAfter(tokens, 'BILL MONTH')
  if (!billMonth) {
    return null
  }
  return {
    billMonth,
    units: numberAfter(tokens, 'UNITS'),
    grandTotalPkr: numberAfter(tokens, 'Grand Total'),
    payableAfterDuePkr: (() => {
      // last amount after the 'After DD-MMM-YY' token
      const i = tokens.findIndex(t => /^After \d{2}-[A-Z]{3}-\d{2}$/i.test(t))
      return i >= 0 ? toNumber(tokens[i + 1]) : null
    })(),
    fpaPkr: numberAfter(tokens, 'Total FPA'),
    readingDate: dateAfter(tokens, 'READING DATE'),
    issueDate: dateAfter(tokens, 'ISSUE DATE'),
    dueDate: dateAfter(tokens, 'DUE DATE'),
    history: parseHistory(tokens)
  }
}
