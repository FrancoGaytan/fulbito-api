import { abilityKeys, type AbilityKey, isAbilityKey } from '../constants/abilities'

export type AbilityScores = Partial<Record<AbilityKey, number>>

/**
 * Acepta:
 *  - NUEVO: { defense: 8, passes: 7, ... }
 *  - VIEJO: ["defense","passes", ...]  -> lo mapea a puntaje default
 */
export function normalizeAbilitiesInput(
  input: unknown,
  defaultScore = 7
): AbilityScores | undefined {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const out: AbilityScores = {}
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (!isAbilityKey(k)) continue
      const n = Number(v)
      if (!Number.isFinite(n)) continue
      out[k as AbilityKey] = Math.max(1, Math.min(10, Math.round(n)))
    }
    return Object.keys(out).length ? out : undefined
  }

  if (Array.isArray(input)) {
    const out: AbilityScores = {}
    for (const k of input) if (isAbilityKey(k)) out[k] = defaultScore
    return Object.keys(out).length ? out : undefined
  }

  return undefined
}
