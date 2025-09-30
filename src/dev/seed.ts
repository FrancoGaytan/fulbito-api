import { Types } from 'mongoose';
import { Player } from '../models/player.model.js';
import { Group } from '../models/group.model.js';
import { User } from '../models/user.model.js';

type AbilityScore = { key: string; value: number };
type SeedPlayer = { name: string; abilities: AbilityScore[] };

const playersData: SeedPlayer[] = [
  { name: 'Ariel', abilities: [
    { key: 'goalkeeper', value: 4 }, { key: 'defense', value: 8 },
    { key: 'passes', value: 7 }, { key: 'running', value: 6 },
    { key: 'power', value: 7 }, { key: 'scorer', value: 5 },
    { key: 'positionalUnderstanding', value: 8 },
  ]},
  { name: 'Bruno', abilities: [
    { key: 'goalkeeper', value: 3 }, { key: 'defense', value: 6 },
    { key: 'passes', value: 8 }, { key: 'running', value: 8 },
    { key: 'power', value: 6 }, { key: 'scorer', value: 7 },
    { key: 'positionalUnderstanding', value: 7 },
  ]},
  { name: 'Camila', abilities: [
    { key: 'goalkeeper', value: 2 }, { key: 'defense', value: 5 },
    { key: 'passes', value: 9 }, { key: 'running', value: 7 },
    { key: 'power', value: 5 }, { key: 'scorer', value: 8 },
    { key: 'positionalUnderstanding', value: 8 },
  ]},
  { name: 'Diego', abilities: [
    { key: 'goalkeeper', value: 9 }, { key: 'defense', value: 7 },
    { key: 'passes', value: 6 }, { key: 'running', value: 4 },
    { key: 'power', value: 6 }, { key: 'scorer', value: 3 },
    { key: 'positionalUnderstanding', value: 7 },
  ]},
  { name: 'Eva', abilities: [
    { key: 'goalkeeper', value: 1 }, { key: 'defense', value: 6 },
    { key: 'passes', value: 7 }, { key: 'running', value: 9 },
    { key: 'power', value: 7 }, { key: 'scorer', value: 8 },
    { key: 'positionalUnderstanding', value: 7 },
  ]},
  { name: 'Facu', abilities: [
    { key: 'goalkeeper', value: 2 }, { key: 'defense', value: 5 },
    { key: 'passes', value: 6 }, { key: 'running', value: 8 },
    { key: 'power', value: 8 }, { key: 'scorer', value: 7 },
    { key: 'positionalUnderstanding', value: 6 },
  ]},
];

function buildPlayersDocs(seed: SeedPlayer[], ownerId: string) {
  const owner = new Types.ObjectId(ownerId);
  const now = new Date();

  return seed.map((p) => ({
    name: p.name,
  abilities: p.abilities.map(a => a.key),
    rating: 1000,
  ratingHistory: [],
  skillHistory: p.abilities.map(a => ({
      key: a.key, value: a.value, at: now,
    })),
    owner,
  }));
}

/** Seed usando ownerId directo */
export async function runSeedByOwnerId(ownerId: string, { wipe = true } = {}) {
  if (!Types.ObjectId.isValid(ownerId)) {
    throw new Error('ownerId inválido');
  }

  if (wipe) {
    await Player.deleteMany({});
    await Group.deleteMany({});
  }

  const playerDocs = buildPlayersDocs(playersData, ownerId);
  const createdPlayers = await Player.insertMany(playerDocs);

  const memberIds = createdPlayers.slice(0, 5).map(p => p._id as Types.ObjectId);

  const group = await Group.create({
    name: 'Fulbito del jueves',
    members: memberIds,
    owner: new Types.ObjectId(ownerId),
  });

  return {
    players: createdPlayers.length,
    group: { id: String(group._id), name: group.name, members: group.members.length },
  };
}

/** Seed buscando el owner por email (conveniente) */
export async function runSeedByEmail(email: string, opts?: { wipe?: boolean }) {
  const user = await User.findOne({ email }).select('_id');
  if (!user) throw new Error(`No existe usuario con email ${email}`);
  return runSeedByOwnerId((user._id as Types.ObjectId).toString(), opts);
}
