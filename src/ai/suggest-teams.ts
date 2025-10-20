import { z } from 'zod';
import { getGemini } from './gemini.js';

const Out = z.object({
  teams: z
    .array(z.object({ name: z.string(), players: z.array(z.string()) }))
    .length(2),
});

export interface AiTeams {
  teams: { name: string; players: string[] }[];
  _meta?: { prompt: string; rawText: string; modelUsed?: string; triedModels?: string[] };
}

export async function suggestTeamsWithGemini(input: {
  participants: Array<{
    id: string;
    name: string;
    rating: number;
    abilities: Record<string, number>;
  }>;
  seed?: number;
}): Promise<AiTeams> {
  const slim = input.participants.map(p => ({
    id: p.id,
    rating: p.rating,
    abilityScore: Object.values(p.abilities || {}).reduce((a, v) => a + (typeof v === 'number' ? v : 0), 0),
  }));
  const prompt = `
Eres un organizador de partidos de fútbol.
Objetivo: formar 2 equipos ("A" y "B") muy equilibrados usando principalmente 'rating' y secundariamente 'abilityScore'.

Datos:
PARTICIPANTES=${JSON.stringify(slim)}
SEMILLA=${input.seed ?? 'none'}

Definiciones:
TopRating = jugadores en el 20% superior por rating.
TopAbility = jugadores en el 20% superior por abilityScore.

Reglas estrictas:
1. Cada jugador aparece EXACTAMENTE una vez en A o B.
2. Diferencia de cantidad entre equipos ≤ 1.
3. No concentres más de ceil(|TopRating|/2) jugadores de TopRating en un solo equipo. Igual para TopAbility.
4. Minimiza |sumaRating(A) - sumaRating(B)| y luego |sumaAbility(A) - sumaAbility(B)|.
5. Si dos asignaciones son similares, elige la que dispersa mejor los 3 ratings más altos.
6. Salida SOLO JSON EXACTO sin comentarios ni texto adicional:
{"teams":[{"name":"A","players":["<id>","<id>", ...]},{"name":"B","players":["<id>","<id>", ...]}]}
7. Solo usa IDs provistos y exactamente dos objetos de equipo.
`.trim();

  const tried: string[] = [];
  const candidates = [ process.env.GEMINI_MODEL || 'gemini-pro-latest' ];
  let lastError: Error | null = null;
  let rawText = '';
  let usedModel = '';
  for (const m of candidates) {
    if (tried.includes(m)) continue;
    tried.push(m);
    try {
      const model = getGemini(m);
      const resp = await model.generateContent(prompt);
      rawText = resp.response.text();
      usedModel = m;
      lastError = null;
      break;
    } catch (e) {
      lastError = e as Error;
    }
  }
  if (lastError && !rawText) {
    throw lastError;
  }

  let parsed: any;
  try {
    parsed = JSON.parse(rawText);
  } catch (e) {
    throw new Error('AI_JSON_PARSE_ERROR');
  }
  const valid = Out.safeParse(parsed);
  if (!valid.success) {
    throw new Error('AI_SCHEMA_ERROR');
  }
  return { teams: valid.data.teams, _meta: { prompt, rawText, modelUsed: usedModel, triedModels: tried } };
}
