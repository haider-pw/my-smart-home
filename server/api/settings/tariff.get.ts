import { useDb } from '../../utils/db'
import { getTariffConfig } from '../../utils/tariff-settings'

/** GET /api/settings/tariff — stored config, or the documented defaults. */
export default defineEventHandler(async () => {
  const db = useDb()
  const { config, isDefault } = await getTariffConfig(db)
  return {
    success: true as const,
    data: { config, isDefault },
    error: null
  }
})
