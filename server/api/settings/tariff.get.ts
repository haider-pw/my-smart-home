import { eq } from 'drizzle-orm'
import { DEFAULT_TARIFF, tariffFromStored } from '../../../shared/utils/tariff'
import * as schema from '../../db/schema'
import { useDb } from '../../utils/db'

export const TARIFF_SETTINGS_KEY = 'tariff'

/** GET /api/settings/tariff — stored config, or the documented defaults. */
export default defineEventHandler(async () => {
  const db = useDb()
  const row = await db.select().from(schema.settings).where(eq(schema.settings.key, TARIFF_SETTINGS_KEY)).get()

  const config = row ? tariffFromStored(row.value as string) : DEFAULT_TARIFF
  return {
    success: true as const,
    data: { config, isDefault: !row },
    error: null
  }
})
