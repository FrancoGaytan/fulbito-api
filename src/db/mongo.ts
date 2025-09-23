import mongoose from 'mongoose';

export async function connectMongo(uri: string) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(process.env.MONGODB_URI!, {
    dbName: 'footy',
    serverSelectionTimeoutMS: 15000,
    socketTimeoutMS: 45000,
  });

  await mongoose.connection.getClient().db().command({ ping: 1 });
  console.log('✅ MongoDB conectado');
}
