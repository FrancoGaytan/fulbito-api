/**
 * Migration Script: Move legacy Player.rating & basic stats into GroupMembership.
 *
 * Strategy:
 *  - For each Player where legacyRatingsMigrated=false:
 *    * Load all memberships for that player.
 *    * If none: create one in (or create) a fallback group (LEGACY_GROUP_NAME env or "Legacy Group").
 *    * Copy rating -> membership.rating (overwrite if membership.gamesPlayed == 0).
 *    * Copy gamesPlayed only to first (or newly created) membership to avoid inflating stats across groups.
 *    * (wins/losses/draws not present in Player -> only rating & gamesPlayed are migrated.)
 *    * Mark player.legacyRatingsMigrated=true.
 *  - Idempotent: repeated runs skip migrated players.
 *  - Safe rollback: run a mongodump before, or manually unset legacyRatingsMigrated and adjust memberships.
 */
import 'dotenv/config';
import { connectMongo } from '../src/db/mongo.js';
import { Player } from '../src/models/player.model.js';
import { Group } from '../src/models/group.model.js';
import { GroupMembership } from '../src/models/groupMembership.model.js';
import mongoose from 'mongoose';

async function ensureFallbackGroup(ownerId?: any) {
  const name = process.env.LEGACY_GROUP_NAME || 'Legacy Group';
  let group = await Group.findOne({ name });
  if (!group) {
    group = await Group.create({ name, owner: ownerId, members: [] });
    console.log('> Created fallback group:', name);
  }
  return group;
}

async function migrate() {
  await connectMongo();
  console.log('> Starting ratings migration');

  const players = await Player.find({ $or: [{ legacyRatingsMigrated: { $ne: true } }, { legacyRatingsMigrated: { $exists: false } }] });
  console.log(`> Players pending migration: ${players.length}`);

  const baseline = Number(process.env.MEMBERSHIP_BASELINE_RATING || 1000);
  let migrated = 0;

  for (const p of players) {
    const playerId = p._id;
    const legacyRating = (typeof p.rating === 'number' ? p.rating : baseline) || baseline;
    const legacyGames = p.gamesPlayed || 0;

    const memberships = await GroupMembership.find({ playerId });

    if (memberships.length === 0) {
      // Create fallback membership
      const fallback = await ensureFallbackGroup(p.owner || p.userId);
      await GroupMembership.create({
        groupId: fallback._id,
        playerId,
        rating: legacyRating < 500 ? 500 : legacyRating, // clamp min
        gamesPlayed: legacyGames,
      });
      console.log(`  + Player ${playerId} -> created fallback membership (rating=${legacyRating}, games=${legacyGames})`);
    } else {
      let first = true;
      for (const m of memberships) {
        const shouldOverwrite = m.gamesPlayed === 0; // don't override if membership already active
        if (shouldOverwrite) {
          m.rating = legacyRating < 500 ? 500 : legacyRating;
        }
        if (first && legacyGames > 0) {
          m.gamesPlayed = (m.gamesPlayed || 0) + legacyGames;
          first = false;
        }
        await m.save();
      }
      console.log(`  * Player ${playerId} -> updated ${memberships.length} membership(s)`);
    }

    p.legacyRatingsMigrated = true;
    await p.save();
    migrated++;
  }

  console.log(`> Migration complete. Migrated players: ${migrated}`);
  await mongoose.connection.close();
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
