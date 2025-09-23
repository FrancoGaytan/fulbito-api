import { Types } from 'mongoose';
import { PlayerModel } from '../models/players/player.model.js';
import { GroupModel } from '../models/groups/group.model.js';

const playersData = [
  {
    name: 'Ariel',
    abilities: [
      { key: 'goalkeeper', value: 4 },
      { key: 'defense', value: 8 },
      { key: 'passes', value: 7 },
      { key: 'running', value: 6 },
      { key: 'power', value: 7 },
      { key: 'scorer', value: 5 },
      { key: 'positionalUnderstanding', value: 8 },
    ],
  },
  {
    name: 'Bruno',
    abilities: [
      { key: 'goalkeeper', value: 3 },
      { key: 'defense', value: 6 },
      { key: 'passes', value: 8 },
      { key: 'running', value: 8 },
      { key: 'power', value: 6 },
      { key: 'scorer', value: 7 },
      { key: 'positionalUnderstanding', value: 7 },
    ],
  },
  {
    name: 'Camila',
    abilities: [
      { key: 'goalkeeper', value: 2 },
      { key: 'defense', value: 5 },
      { key: 'passes', value: 9 },
      { key: 'running', value: 7 },
      { key: 'power', value: 5 },
      { key: 'scorer', value: 8 },
      { key: 'positionalUnderstanding', value: 8 },
    ],
  },
  {
    name: 'Diego',
    abilities: [
      { key: 'goalkeeper', value: 9 },
      { key: 'defense', value: 7 },
      { key: 'passes', value: 6 },
      { key: 'running', value: 4 },
      { key: 'power', value: 6 },
      { key: 'scorer', value: 3 },
      { key: 'positionalUnderstanding', value: 7 },
    ],
  },
  {
    name: 'Eva',
    abilities: [
      { key: 'goalkeeper', value: 1 },
      { key: 'defense', value: 6 },
      { key: 'passes', value: 7 },
      { key: 'running', value: 9 },
      { key: 'power', value: 7 },
      { key: 'scorer', value: 8 },
      { key: 'positionalUnderstanding', value: 7 },
    ],
  },
  {
    name: 'Facu',
    abilities: [
      { key: 'goalkeeper', value: 2 },
      { key: 'defense', value: 5 },
      { key: 'passes', value: 6 },
      { key: 'running', value: 8 },
      { key: 'power', value: 8 },
      { key: 'scorer', value: 7 },
      { key: 'positionalUnderstanding', value: 6 },
    ],
  },
];

export async function runSeed() {
  // Limpio solo para la demo (si no querés borrar, sacá estas líneas)
  await PlayerModel.deleteMany({});
  await GroupModel.deleteMany({});

  const createdPlayers = await PlayerModel.insertMany(playersData);
  const memberIds = createdPlayers.slice(0, 5).map((p) => p._id as Types.ObjectId);

  const group = await GroupModel.create({
    name: 'Fulbito del jueves',
    members: memberIds,
  });

  return {
    players: createdPlayers.length,
    group: { id: String(group._id), name: group.name, members: group.members.length },
  };
}
