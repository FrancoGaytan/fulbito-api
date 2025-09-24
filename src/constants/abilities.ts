export const abilityKeys = [
  'goalkeeper',
  'running',
  'passes',
  'defense',
  'power',
  'scorer',
  'positionalUnderstanding',
] as const

export type AbilityKey = typeof abilityKeys[number]

export function isAbilityKey(x: unknown): x is AbilityKey {
  return abilityKeys.includes(x as AbilityKey)
}