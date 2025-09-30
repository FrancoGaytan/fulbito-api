export function shuffle<T>(arr: readonly T[]): T[] {
  const a: T[] = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp!;
  }
  return a;
}
