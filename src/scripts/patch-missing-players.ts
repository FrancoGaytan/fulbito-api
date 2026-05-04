/**
 * Crea un documento Player para cada SpaceMembership que no tenga uno en ese space.
 * Ejecutar con: npx tsx src/scripts/patch-missing-players.ts
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { SpaceMembership } from '../models/space-membership.model.js';
import { Player } from '../models/player.model.js';
import { User } from '../models/user.model.js';

const MONGODB_URI = process.env.MONGODB_URI!;

async function run() {
  await mongoose.connect(MONGODB_URI, { dbName: 'footy-2' });
  console.log('Connected to footy-2');

  const memberships = await SpaceMembership.find().lean();
  let created = 0;
  let skipped = 0;

  for (const m of memberships) {
    const userId = m.userId as mongoose.Types.ObjectId;
    const spaceId = m.spaceId as mongoose.Types.ObjectId;

    const existing = await Player.findOne({
      spaceId,
      $or: [{ owner: userId }, { userId }],
    }).lean();

    if (existing) {
      skipped++;
      continue;
    }

    const user = await User.findById(userId).select('email').lean();
    const nameBase = user?.email?.split('@')[0] ?? 'jugador';

    await Player.create({
      name: nameBase,
      owner: userId,
      userId,
      spaceId,
      rating: 1000,
      gamesPlayed: 0,
    });
    console.log(`  Created player "${nameBase}" for user ${userId} in space ${spaceId}`);
    created++;
  }

  console.log(`\nDone: ${created} created, ${skipped} already existed`);
  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
