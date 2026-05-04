/**
 * Migración: crear SpacePlayer para cada Player con userId en el space Fulbito.
 * Rating y gamesPlayed se copian desde el Player global existente.
 * Si ya existe un SpacePlayer (de una ejecución previa), se saltea.
 *
 * Ejecutar: npx tsx src/scripts/migrate-spaceplayers.ts
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { SpaceMembership } from '../models/space-membership.model.js';
import { SpacePlayer } from '../models/space-player.model.js';
import { Player } from '../models/player.model.js';
import { Space } from '../models/space.model.js';

const MONGODB_URI = process.env.MONGODB_URI!;

async function run() {
  await mongoose.connect(MONGODB_URI, { dbName: 'footy-2' });
  console.log('Connected to footy-2\n');

  const spaces = await Space.find().lean();
  console.log(`Spaces encontrados: ${spaces.length}`);

  let totalCreated = 0;
  let totalSkipped = 0;

  for (const space of spaces) {
    const spaceId = space._id as mongoose.Types.ObjectId;
    console.log(`\n--- Space: "${space.name}" (${spaceId}) ---`);

    const memberships = await SpaceMembership.find({ spaceId }).lean();
    console.log(`  Miembros: ${memberships.length}`);

    for (const m of memberships) {
      const userId = m.userId as mongoose.Types.ObjectId;

      // Buscar el Player global de este usuario
      const player = await Player.findOne({
        $or: [{ userId }, { owner: userId }],
        userId: { $exists: true, $ne: null },
      }).lean();

      if (!player) {
        console.log(`  SKIP: user ${userId} sin Player global`);
        totalSkipped++;
        continue;
      }

      // Verificar si ya existe SpacePlayer
      const existing = await SpacePlayer.findOne({ spaceId, userId }).lean();
      if (existing) {
        console.log(`  SKIP: SpacePlayer ya existe para "${player.name}" en este space`);
        totalSkipped++;
        continue;
      }

      await SpacePlayer.create({
        spaceId,
        userId,
        name: (player as any).name,
        nickname: (player as any).nickname,
        abilities: (player as any).abilities,
        rating: (player as any).rating ?? 1000,
        gamesPlayed: (player as any).gamesPlayed ?? 0,
      });

      console.log(`  CREATED: "${(player as any).name}" rating=${(player as any).rating ?? 1000} gamesPlayed=${(player as any).gamesPlayed ?? 0}`);
      totalCreated++;
    }
  }

  console.log(`\n========================================`);
  console.log(`Total creados:  ${totalCreated}`);
  console.log(`Total salteados: ${totalSkipped}`);
  console.log(`========================================`);

  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
