import { describe, expect, it } from 'vitest'
import { keysToPrune, parseBackupTs, type BackupObject } from '../../server/utils/backup-retention'

const DAY = 24 * 60 * 60 * 1000

describe('parseBackupTs', () => {
  it('extracts the date from a backup key', () => {
    expect(parseBackupTs('backups/2026-07-11T18-30-00.json.gz')).toBe(Date.UTC(2026, 6, 11))
  })

  it('returns null for a keyless string', () => {
    expect(parseBackupTs('backups/latest.json.gz')).toBeNull()
  })
})

describe('keysToPrune', () => {
  const now = Date.UTC(2026, 6, 11)

  function obj(daysAgo: number, tag = ''): BackupObject {
    return { key: `backups/d${daysAgo}${tag}`, ts: now - daysAgo * DAY }
  }

  it('keeps everything within the 14-day daily window', () => {
    const objects = [obj(0), obj(5), obj(13)]

    expect(keysToPrune(objects, now)).toEqual([])
  })

  it('keeps one backup per month beyond the daily window', () => {
    // Two backups 20 and 35 days ago — both in June, both past the 14-day
    // window → keep the newer monthly keeper, prune the older.
    const older = obj(35, 'a')
    const newer = obj(20, 'b')

    const pruned = keysToPrune([older, newer], now)

    expect(pruned).toContain(older.key)
    expect(pruned).not.toContain(newer.key)
  })

  it('prunes months older than the 12-month monthly window', () => {
    const veryOld = obj(400)

    expect(keysToPrune([veryOld], now)).toContain(veryOld.key)
  })

  it('a fresh daily backup within a kept month is retained by the daily rule', () => {
    const objects = [obj(1), obj(2), obj(3)]

    expect(keysToPrune(objects, now)).toEqual([])
  })
})
