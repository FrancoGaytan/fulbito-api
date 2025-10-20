import { GoogleGenerativeAI } from '@google/generative-ai';

const apiKey = process.env.GEMINI_API_KEY || '';
const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

// Fallback list (ordered by likelihood of availability)
export const FALLBACK_MODELS = [
  'gemini-1.5-flash-latest',
  'gemini-1.5-pro-latest',
  'gemini-pro',
  'gemini-pro-latest',
];

export function getGemini(modelName?: string) {
  if (!genAI) throw new Error('AI_DISABLED');
  const requested = (modelName || process.env.GEMINI_MODEL || FALLBACK_MODELS[0] || 'gemini-pro') + '';
  return genAI.getGenerativeModel({
    model: requested,
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.3,
      topP: 0.9,
    },
  });
}

// Manual fetch of available models (best-effort; may change)
export async function listAvailableModels(): Promise<string[]> {
  if (!apiKey) return [];
  try {
    const resp = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!resp.ok) return [];
    const data = await resp.json() as any;
    const models = Array.isArray(data.models) ? data.models : [];
    return models.map((m: any) => String(m.name).replace(/^models\//, ''));
  } catch {
    return [];
  }
}
