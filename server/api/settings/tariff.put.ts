import { DEFAULT_TARIFF, tariffFromStored, tariffToStored, type TariffConfig } from '../../../shared/utils/tariff'
import * as schema from '../../db/schema'
import { useDb } from '../../utils/db'
import { TARIFF_SETTINGS_KEY } from './tariff.get'

function isValidSlabArray(slabs: unknown): boolean {
  return Array.isArray(slabs)
    && slabs.length > 0
    && slabs.every(s => typeof s === 'object' && s !== null
      && (typeof (s as { upto: unknown }).upto === 'number' || (s as { upto: unknown }).upto === null)
      && typeof (s as { rate: unknown }).rate === 'number' && (s as { rate: number }).rate >= 0)
}

/**
 * PUT /api/settings/tariff — replaces the tariff configuration.
 * Validates structure at the boundary; unknown fields are dropped by
 * reconstructing from the known shape.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<TariffConfig>(event).catch(() => null)
  if (!body || typeof body !== 'object') {
    setResponseStatus(event, 400)
    return { success: false as const, data: null, error: 'JSON body required' }
  }

  // Normalize through the JSON round-trip first (null → Infinity)
  const candidate = tariffFromStored(JSON.stringify(body))

  const errors: string[] = []
  if (!isValidSlabArray(candidate.slabs?.unprotected) || !isValidSlabArray(candidate.slabs?.protected)) {
    errors.push('slabs.protected and slabs.unprotected must be non-empty {upto, rate} arrays')
  }
  if (candidate.meterType !== 'single-phase' && candidate.meterType !== 'tou') {
    errors.push('meterType must be single-phase | tou')
  }
  if (candidate.category !== 'protected' && candidate.category !== 'unprotected') {
    errors.push('category must be protected | unprotected')
  }
  if (!Number.isInteger(candidate.cycleAnchorDay) || candidate.cycleAnchorDay < 1 || candidate.cycleAnchorDay > 28) {
    errors.push('cycleAnchorDay must be an integer 1–28')
  }
  if (candidate.effectiveRatePkr !== null && (typeof candidate.effectiveRatePkr !== 'number' || candidate.effectiveRatePkr <= 0)) {
    errors.push('effectiveRatePkr must be a positive number or null')
  }
  if (typeof candidate.budget?.green !== 'number' || typeof candidate.budget?.red !== 'number' || candidate.budget.green > candidate.budget.red) {
    errors.push('budget.green and budget.red must be numbers with green ≤ red')
  }

  if (errors.length > 0) {
    setResponseStatus(event, 422)
    return { success: false as const, data: null, error: errors.join('; ') }
  }

  // Reconstruct explicitly — nothing outside the known shape is persisted
  const config: TariffConfig = {
    slabs: candidate.slabs,
    previousSlabBenefitDepth: {
      unprotected: candidate.previousSlabBenefitDepth?.unprotected ?? DEFAULT_TARIFF.previousSlabBenefitDepth.unprotected,
      protected: candidate.previousSlabBenefitDepth?.protected ?? DEFAULT_TARIFF.previousSlabBenefitDepth.protected
    },
    tou: candidate.tou ?? DEFAULT_TARIFF.tou,
    surcharges: { ...DEFAULT_TARIFF.surcharges, ...candidate.surcharges },
    meterType: candidate.meterType,
    category: candidate.category,
    cycleAnchorDay: candidate.cycleAnchorDay,
    effectiveRatePkr: candidate.effectiveRatePkr,
    budget: candidate.budget
  }

  const db = useDb()
  await db.insert(schema.settings)
    .values({ key: TARIFF_SETTINGS_KEY, value: tariffToStored(config), updatedAt: Date.now() })
    .onConflictDoUpdate({
      target: schema.settings.key,
      set: { value: tariffToStored(config), updatedAt: Date.now() }
    })

  return { success: true as const, data: { config }, error: null }
})
