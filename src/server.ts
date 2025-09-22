import 'dotenv/config';
import { connectMongo } from './db/mongo.js';
import { buildApp } from './app.js';

async function main() {
  const { MONGODB_URI, PORT } = process.env;
  if (!MONGODB_URI) throw new Error('Falta MONGODB_URI en .env');

  await connectMongo(MONGODB_URI);
  const app = buildApp();
  app.listen(Number(PORT ?? 3000), () =>
    console.log(`🚀 API http://localhost:${PORT ?? 3000}`),
  );
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});