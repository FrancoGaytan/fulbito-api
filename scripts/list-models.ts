import 'dotenv/config';
import { FALLBACK_MODELS, getGemini, listAvailableModels } from '../src/ai/gemini.js';

async function testModel(id: string) {
  try {
    const model = getGemini(id);
    // Prompt mínimo que debería retornar JSON simple si el modelo soporta generateContent.
    const resp: any = await model.generateContent('Devuelve SOLO este JSON exacto {"ping":"pong"}');
    const text = resp.response?.text?.() ?? '';
    return { model: id, ok: true, text: text.slice(0, 120) };
  } catch (e) {
    return { model: id, ok: false, error: (e as Error).message };
  }
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('Falta GEMINI_API_KEY en el entorno.');
    process.exit(1);
  }

  console.log('Listando modelos disponibles vía endpoint v1beta...');
  const available = await listAvailableModels();
  if (!available.length) {
    console.log('No se recibieron modelos (lista vacía o error). Posible clave sin acceso / endpoint cambiado).');
  } else {
    for (const m of available) {
      console.log('  -', m);
    }
  }

  console.log('\nProbando fallback interno uno por uno:');
  for (const id of FALLBACK_MODELS) {
    const r = await testModel(id);
    if (r.ok) {
      console.log(`[OK] ${id} -> respuesta parcial: ${r.text}`);
    } else {
      console.log(`[FAIL] ${id} -> ${r.error}`);
    }
  }

  // Si definiste GEMINI_MODEL prueba también ese específico (si no está ya en fallback)
  const configured = process.env.GEMINI_MODEL;
  if (configured && !FALLBACK_MODELS.includes(configured)) {
    console.log(`\nProbando modelo configurado (GEMINI_MODEL=${configured})`);
    const r = await testModel(configured);
    if (r.ok) console.log(`[OK] ${configured} -> ${r.text}`);
    else console.log(`[FAIL] ${configured} -> ${r.error}`);
  }

  console.log('\nFin del diagnóstico.');
}

main().catch(e => {
  console.error('Error general en script:', e);
  process.exit(1);
});
