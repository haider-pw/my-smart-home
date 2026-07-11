import { eq } from 'drizzle-orm'
import { DEFAULT_TARIFF, tariffFromStored, type TariffConfig } from '../../shared/utils/tariff'
import * as schema from '../db/schema'
import type { Db } from './db'

export const TARIFF_SETTINGS_KEY = 'tariff'

/** Stored tariff configuration, or the documented defaults. */
export async function getTariffConfig(db: Db): Promise<{ config: TariffConfig, isDefault: boolean }> {
  const row = await db.select().from(schema.settings).where(eq(schema.settings.key, TARIFF_SETTINGS_KEY)).get()
  return row
    ? { config: tariffFromStored(row.value as string), isDefault: false }
    : { config: DEFAULT_TARIFF, isDefault: true }
}
