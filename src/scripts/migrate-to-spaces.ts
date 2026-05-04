/**
 * migrate-to-spaces.ts
 *
 * Script one-shot para migrar la DB `footy` a `footy-2` con soporte de Spaces.
 *
 * Qué hace:
 * 1. Conecta a MongoDB Atlas usando MONGODB_URI del .env
 * 2. Lee todos los datos de `footy` (usuarios, grupos, partidos, jugadores)
 * 3. Crea un Space default "Fulbito" en `footy-2`
 * 4. Crea SpaceMembership para todos los usuarios existentes
 * 5. Asigna role 'admin' a gaytanfranco@gmail.com
 * 6. Migra Players → SpacePlayers (copiando rating, abilities, gamesPlayed)
 * 7. Migra Groups y Matches agregándoles spaceId
 * 8. Copia los documentos a la nueva DB (Users, Groups, Matches, Players, MatchVotes)
 *
 * Uso:
 *   npx tsx src/scripts/migrate-to-spaces.ts
 */

import 'dotenv/config';
import mongoose, { Types } from 'mongoose';

const ADMIN_EMAIL = 'gaytanfranco@gmail.com';

/* ---- Schemas de origen (footy) ---- */
const UserSchema = new mongoose.Schema({
  email: String,
  passwordHash: String,
  resetCodeHash: String,
  resetCodeExpires: Date,
  passwordResetSessionToken: String,
}, { timestamps: true, strict: false });

const PlayerSchema = new mongoose.Schema({
  name: String,
  nickname: String,
  abilities: { type: Map, of: Number },
  rating: Number,
  gamesPlayed: Number,
  userId: mongoose.Schema.Types.ObjectId,
  owner: mongoose.Schema.Types.ObjectId,
}, { timestamps: true, strict: false });

const GroupSchema = new mongoose.Schema({
  name: String,
  members: [mongoose.Schema.Types.ObjectId],
  owner: mongoose.Schema.Types.ObjectId,
}, { timestamps: true, strict: false });

const MatchSchema = new mongoose.Schema({}, { strict: false, timestamps: true });
const MatchVoteSchema = new mongoose.Schema({}, { strict: false });

/* ---- Schemas de destino (footy-2) ---- */
const SpaceSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: String,
  owner: mongoose.Schema.Types.ObjectId,
  inviteCode: { type: String, required: true, unique: true },
}, { timestamps: true });

const SpaceMembershipSchema = new mongoose.Schema({
  spaceId: mongoose.Schema.Types.ObjectId,
  userId: mongoose.Schema.Types.ObjectId,
  role: { type: String, default: 'member' },
  joinedAt: { type: Date, default: () => new Date() },
});
SpaceMembershipSchema.index({ spaceId: 1, userId: 1 }, { unique: true });

const SpacePlayerSchema = new mongoose.Schema({
  spaceId: mongoose.Schema.Types.ObjectId,
  userId: mongoose.Schema.Types.ObjectId,
  name: String,
  nickname: String,
  abilities: { type: Map, of: Number },
  rating: { type: Number, default: 1000 },
  gamesPlayed: { type: Number, default: 0 },
}, { timestamps: true });
SpacePlayerSchema.index({ spaceId: 1, userId: 1 }, { unique: true });

/* ---- helpers ---- */
function genCode(): string {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => c[Math.floor(Math.random() * c.length)]).join('');
}

async function run() {
  const uri = process.env.MONGODB_URI!;
  if (!uri) throw new Error('MONGODB_URI no está definida en .env');

  // Conexión a footy (origen)
  console.log('Conectando a footy (origen)...');
  const srcConn = await mongoose.createConnection(uri, { dbName: 'footy' }).asPromise();

  const SrcUser = srcConn.model('User', UserSchema);
  const SrcPlayer = srcConn.model('Player', PlayerSchema);
  const SrcGroup = srcConn.model('Group', GroupSchema);
  const SrcMatch = srcConn.model('Match', MatchSchema, 'matches');
  const SrcMatchVote = srcConn.model('MatchVote', MatchVoteSchema, 'matchvotes');

  // Conexión a footy-2 (destino)
  console.log('Conectando a footy-2 (destino)...');
  const dstConn = await mongoose.createConnection(uri, { dbName: 'footy-2' }).asPromise();

  const DstUser = dstConn.model('User', UserSchema.clone());
  const DstPlayer = dstConn.model('Player', PlayerSchema.clone());
  const DstGroup = dstConn.model('Group', GroupSchema.clone());
  const DstMatch = dstConn.model('Match', MatchSchema.clone(), 'matches');
  const DstMatchVote = dstConn.model('MatchVote', MatchVoteSchema.clone(), 'matchvotes');
  const DstSpace = dstConn.model('Space', SpaceSchema);
  const DstSpaceMembership = dstConn.model('SpaceMembership', SpaceMembershipSchema);
  const DstSpacePlayer = dstConn.model('SpacePlayer', SpacePlayerSchema);

  // 1. Leer datos origen
  console.log('\n=== Leyendo datos origen ===');
  const [users, players, groups, matches, matchVotes] = await Promise.all([
    SrcUser.find().lean(),
    SrcPlayer.find().lean(),
    SrcGroup.find().lean(),
    SrcMatch.find().lean(),
    SrcMatchVote.find().lean(),
  ]);
  console.log(`  Usuarios: ${users.length}`);
  console.log(`  Jugadores: ${players.length}`);
  console.log(`  Grupos: ${groups.length}`);
  console.log(`  Partidos: ${matches.length}`);
  console.log(`  MatchVotes: ${matchVotes.length}`);

  // 2. Crear Space default
  console.log('\n=== Creando Space default ===');
  const adminUser = users.find(u => (u as any).email?.toLowerCase() === ADMIN_EMAIL.toLowerCase());
  if (!adminUser) console.warn(`  ⚠️  Usuario ${ADMIN_EMAIL} no encontrado — se creará el space sin owner específico`);

  const ownerId = adminUser ? adminUser._id as Types.ObjectId : new Types.ObjectId();

  let defaultSpace = await DstSpace.findOne({ name: 'Fulbito' }).lean();
  if (!defaultSpace) {
    defaultSpace = await DstSpace.create({
      name: 'Fulbito',
      description: 'Space por defecto — todos los usuarios existentes',
      owner: ownerId,
      inviteCode: genCode(),
    });
    console.log(`  Space creado: ${(defaultSpace as any)._id} — código: ${(defaultSpace as any).inviteCode}`);
  } else {
    console.log(`  Space ya existía: ${(defaultSpace as any)._id}`);
  }
  const spaceId = (defaultSpace as any)._id as Types.ObjectId;

  // 3. Copiar usuarios
  console.log('\n=== Copiando usuarios ===');
  for (const u of users) {
    await DstUser.updateOne({ _id: u._id }, { $set: u }, { upsert: true });
  }
  console.log(`  ${users.length} usuarios copiados`);

  // 4. Crear SpaceMemberships
  console.log('\n=== Creando SpaceMemberships ===');
  for (const u of users) {
    const isAdmin = (u as any).email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    await DstSpaceMembership.updateOne(
      { spaceId, userId: u._id },
      { $set: { spaceId, userId: u._id, role: isAdmin ? 'admin' : 'member', joinedAt: (u as any).createdAt ?? new Date() } },
      { upsert: true },
    );
    if (isAdmin) console.log(`  → ${(u as any).email} asignado como ADMIN`);
  }
  console.log(`  ${users.length} membresías creadas`);

  // 5. Copiar Players y crear SpacePlayers
  console.log('\n=== Copiando Players y creando SpacePlayers ===');
  for (const p of players) {
    await DstPlayer.updateOne({ _id: p._id }, { $set: p }, { upsert: true });

    // Crear SpacePlayer si el player tiene userId
    const uid = (p as any).userId;
    if (uid) {
      const abilitiesObj = (p as any).abilities instanceof Map
        ? Object.fromEntries((p as any).abilities)
        : (p as any).abilities ?? {};

      await DstSpacePlayer.updateOne(
        { spaceId, userId: uid },
        {
          $set: {
            spaceId,
            userId: uid,
            name: (p as any).name,
            nickname: (p as any).nickname,
            abilities: abilitiesObj,
            rating: (p as any).rating ?? 1000,
            gamesPlayed: (p as any).gamesPlayed ?? 0,
          },
        },
        { upsert: true },
      );
    }
  }
  console.log(`  ${players.length} players copiados`);

  // 6. Copiar Grupos con spaceId
  console.log('\n=== Copiando Grupos ===');
  for (const g of groups) {
    await DstGroup.updateOne(
      { _id: g._id },
      { $set: { ...g, spaceId } },
      { upsert: true },
    );
  }
  console.log(`  ${groups.length} grupos copiados`);

  // 7. Copiar Partidos con spaceId
  console.log('\n=== Copiando Partidos ===');
  for (const m of matches) {
    await DstMatch.updateOne(
      { _id: (m as any)._id },
      { $set: { ...m, spaceId } },
      { upsert: true },
    );
  }
  console.log(`  ${matches.length} partidos copiados`);

  // 8. Copiar MatchVotes
  console.log('\n=== Copiando MatchVotes ===');
  for (const v of matchVotes) {
    await DstMatchVote.updateOne(
      { _id: (v as any)._id },
      { $set: v },
      { upsert: true },
    );
  }
  console.log(`  ${matchVotes.length} votes copiados`);

  await srcConn.close();
  await dstConn.close();

  console.log('\n✅ Migración completada. Base de datos: footy-2');
}

run().catch(err => {
  console.error('❌ Error en migración:', err);
  process.exit(1);
});
