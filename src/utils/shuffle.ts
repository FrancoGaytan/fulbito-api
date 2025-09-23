// util chico y tipado: baraja un array sin modificar el original
export function shuffle<T>(arr: readonly T[]): T[] {
  const a: T[] = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    // non-null assertions: i y j están dentro de rango
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp!;
  }
  return a;
}
