import 'dotenv/config';
import mongoose from 'mongoose';

async function run() {
  const uri = process.env.MONGODB_URI as string;
  const conn = await mongoose.createConnection(uri, { dbName: 'footy-2' }).asPromise();
  const db = conn.db as mongoose.mongo.Db;

  const space = await db.collection('spaces').findOne({ name: 'Fulbito' });
  console.log('Space Fulbito:', space?._id);

  const r = await db.collection('players').updateMany(
    { spaceId: { $exists: false } },
    { $set: { spaceId: space?._id } },
  );
  console.log('Players actualizados con spaceId:', r.modifiedCount);

  await conn.close();
}

run().catch(e => { console.error(e); process.exit(1); });
