import mongoose from 'mongoose';

/**
 * Conexión Mongo parametrizable.
 * Prioridad:
 *  1. Parám. uri recibido
 *  2. process.env.MONGODB_URI
 * dbName:
 *  1. process.env.MONGODB_DBNAME
 *  2. 'footy-v2' (fallback rama multi-membership)
 */
export async function connectMongo(uri?: string) {
  const baseUri = uri || process.env.MONGODB_URI;
  if (!baseUri) throw new Error('Missing MONGODB_URI');
  const dbName = process.env.MONGODB_DBNAME || 'footy-v2';

  mongoose.set('strictQuery', true);
  await mongoose.connect(baseUri, {
    dbName,
    serverSelectionTimeoutMS: 15000,
    socketTimeoutMS: 45000,
  });

  await mongoose.connection.getClient().db().command({ ping: 1 });
  console.log(`✅ MongoDB conectado -> dbName=${dbName}`);
}
