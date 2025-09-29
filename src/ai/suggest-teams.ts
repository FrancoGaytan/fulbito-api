import { z } from 'zod';
import { getGemini } from './gemini.js';

const Out = z.object({
  teams: z
    .array(z.object({ name: z.string(), players: z.array(z.string()) }))
    .length(2),
});
export type AiTeams = z.infer<typeof Out>;

export async function suggestTeamsWithGemini(input: {
  participants: Array<{
    id: string;
    name: string;
    rating: number;
    abilities: Record<string, number>;
  }>;
  seed?: number;
}): Promise<AiTeams> {
  const model = getGemini();
  const prompt = `
Eres un organizador de partidos de fútbol.
Objetivo: formar 2 equipos ("A" y "B") lo más equilibrados posible considerando principalmente el campo 'rating'.

Reglas y criterios:
1. Cada jugador debe aparecer EXACTAMENTE una vez en alguno de los dos equipos.
2. El tamaño de los equipos debe diferir como máximo en 1 jugador.
3. Minimiza la diferencia absoluta de la suma de ratings (ideal < 5% del rating total de un equipo; si no se puede, el mínimo posible).
4. Usa abilities (si existen) solo como criterio secundario para repartir jugadores con ratings similares.
5. No inventes ni modifiques ids, usa exactamente los provistos.
6. No agregues comentarios, explicación ni envoltorios (sin Markdown, sin texto extra).
7. Formato de salida ESTRICTO (JSON sin espacios extra fuera del objeto raíz):
{"teams":[{"name":"A","players":["<id>","<id>"]},{"name":"B","players":["<id>","<id>"]}]}

Semilla (puede influir en soluciones alternativas con balance aceptable): ${input.seed ?? 'none'}

Listado de jugadores (rating y abilities):
${JSON.stringify(input.participants, null, 2)}
`.trim();

  const resp = await model.generateContent(prompt);
  const text = resp.response.text();
  const json = JSON.parse(text);
  const valid = Out.safeParse(json);
  if (!valid.success) throw new Error('AI_SCHEMA_ERROR');
  return valid.data;
}
