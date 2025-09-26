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
Eres un organizador de fútbol 5. Divide a los jugadores en 2 equipos equilibrados ("A" y "B")
usando 'rating' y 'abilities'. Usa TODOS los ids provistos, sin duplicados.
Semilla: ${input.seed ?? 'none'}  // Si cambia la semilla, puede variar el split.
Devuelve SOLO JSON:
{"teams":[{"name":"A","players":["<id>",...]},{"name":"B","players":["<id>",...]}]}
Jugadores:
${JSON.stringify(input.participants, null, 2)}
  `.trim();

  const resp = await model.generateContent(prompt);
  const text = resp.response.text();
  const json = JSON.parse(text);
  const valid = Out.safeParse(json);
  if (!valid.success) throw new Error('AI_SCHEMA_ERROR');
  return valid.data;
}
