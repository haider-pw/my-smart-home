import { describe, expect, it } from 'vitest'
import { normalizeBillMonth, parseHistory, parseIescoBill, tokenize } from '../../server/utils/bill-parser'

/** Synthetic PITC-style markup mirroring the real page's label structure. */
const SYNTHETIC_BILL = `
<html><body>
<td>UNITS</td><td>یونٹس</td><td>750</td>
<td>Total FPA</td><td>400</td>
<td>Grand Total</td><td>کل واجبات</td><td>45000</td>
<td>BILL MONTH</td><td>مہینہ بل</td><td>JUN 26</td>
<td>READING DATE</td><td>(Pro-Rata)</td><td>تاریخ</td><td>21 JUN 26</td>
<td>ISSUE DATE</td><td>تاریخ</td><td>24 JUN 26</td>
<td>DUE DATE</td><td>مقررہ</td><td>06 JUL 26</td>
<td>After 09-JUL-26</td><td>48,750</td>
<td>BILL HISTORY</td>
<td>MONTH</td><td>STATUS</td><td>UNITS</td><td>BILL (RS.)</td><td>PAYMENT (RS.)</td>
<td>Feb26</td><td>298</td><td>10893</td><td>10893</td>
<td>Mar26</td><td>EX</td><td>288</td><td>13289</td><td>13289</td>
<td>Apr26</td><td>EX</td><td>316</td><td>16375</td><td>16375</td>
</body></html>`

describe('normalizeBillMonth', () => {
  it('handles both spaced and compact forms', () => {
    expect(normalizeBillMonth('JUN 26')).toBe('2026-06')
    expect(normalizeBillMonth('Feb26')).toBe('2026-02')
    expect(normalizeBillMonth('garbage')).toBeNull()
  })
})

describe('tokenize', () => {
  it('flattens markup to trimmed non-empty tokens', () => {
    const tokens = tokenize('<td> A </td><td></td><td>B</td>')
    expect(tokens).toEqual(['A', 'B'])
  })
})

describe('parseHistory', () => {
  it('reads rows with and without status codes', () => {
    const rows = parseHistory(tokenize(SYNTHETIC_BILL))

    expect(rows).toHaveLength(3)
    expect(rows[0]).toEqual({ billMonth: '2026-02', statusCode: null, units: 298, amountPkr: 10893, paymentPkr: 10893 })
    expect(rows[1]).toEqual({ billMonth: '2026-03', statusCode: 'EX', units: 288, amountPkr: 13289, paymentPkr: 13289 })
  })
})

describe('parseIescoBill', () => {
  it('extracts the current bill fields from label anchors', () => {
    const bill = parseIescoBill(SYNTHETIC_BILL)!

    expect(bill.billMonth).toBe('2026-06')
    expect(bill.units).toBe(750)
    expect(bill.grandTotalPkr).toBe(45000)
    expect(bill.fpaPkr).toBe(400)
    expect(bill.payableAfterDuePkr).toBe(48750)
    expect(bill.readingDate).toBe('21 JUN 26')
    expect(bill.issueDate).toBe('24 JUN 26')
    expect(bill.dueDate).toBe('06 JUL 26')
    expect(bill.history).toHaveLength(3)
  })

  it('returns null for a page without a bill (invalid ref)', () => {
    expect(parseIescoBill('<html><body>Given Ref/App No is invalid</body></html>')).toBeNull()
  })
})
