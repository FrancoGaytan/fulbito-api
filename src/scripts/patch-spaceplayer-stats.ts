/**
 * Patch: actualizar SpacePlayer con los datos reales del Player global.
 * npx tsx src/scripts/patch-spaceplayer-stats.ts
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { SpacePlayer } from '../models/space-player.model.js';
import { Player } from '../models/player.model.js';

async function run() {
  await mongoose.connect(process.env.MONGODB_URI!, { dbName: 'footy-2' });
  console.log('Connected\n');

  const spacePlayers = await SpacePlayer.find().lean();
  console.log(`SpacePlayers a revisar: ${spacePlayers.length}`);

  let updated = 0;
  for (const sp of spacePlayers) {
    const player = await Player.findOne({ userId: sp.userId }).lean();

    if (!player) continue;

    const ratingChanged = (player as any).rating !== undefined && (player as any).rating !== sp.rating;
    const gamesChanged = (player as any).gamesPlayed !== undefined && (player as any).gamesPlayed !== sp.gamesPlayed;

    if (ratingChanged || gamesChanged) {
      await SpacePlayer.updateOne(
        { _id: sp._id },
        {
          $set: {
            rating: (player as any).rating ?? 1000,
            gamesPlayed: (player as any).gamesPlayed ?? 0,
            name: (player as any).name,
            nickname: (player as any).nickname,
          },
        },
      );
      console.log(`Updated "${(player as any).name}": rating ${sp.rating}->${(player as any).rating}, gamesPlayed ${sp.gamesPlayed}->${(player as any).gamesPlayed}`);
      updated++;
    }
  }

  console.log(`\nTotal actualizados: ${updated} / ${spacePlayers.length}`);
  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
