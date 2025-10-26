import 'dotenv/config';
import { connectMongo } from '../src/db/mongo.js';
import { User } from '../src/models/user.model.js';
import { Player } from '../src/models/player.model.js';
import { Group } from '../src/models/group.model.js';
import { GroupMembership } from '../src/models/groupMembership.model.js';
import bcrypt from 'bcryptjs';

async function run() {
  await connectMongo();
  console.log('Seeding multi-group base data...');

  const email = process.env.SEED_ADMIN_EMAIL || 'admin@example.com';
  const password = process.env.SEED_ADMIN_PASSWORD || 'secret123';

  let user = await User.findOne({ email });
  if (!user) {
    user = await User.create({ email, passwordHash: await bcrypt.hash(password, 12) });
    console.log('User creado:', email);
  } else {
    console.log('User existente, reutilizando:', email);
  }

  let player = await Player.findOne({ userId: user._id });
  if (!player) {
    player = await Player.create({ name: 'Admin Player', userId: user._id, owner: user._id });
    console.log('Player creado');
  } else {
    console.log('Player existente');
  }

  const groupName = process.env.SEED_GROUP_NAME || 'Grupo Inicial';
  let group = await Group.findOne({ name: groupName, owner: user._id });
  if (!group) {
    group = await Group.create({ name: groupName, owner: user._id, members: [] });
    console.log('Group creado');
  } else {
    console.log('Group existente');
  }

  // Ensure membership exists
  const existingMembership = await GroupMembership.findOne({ groupId: group._id, playerId: player._id });
  if (!existingMembership) {
    await GroupMembership.create({ groupId: group._id, playerId: player._id, role: 'owner', status: 'active' });
    console.log('Membership creada');
  } else {
    console.log('Membership existente');
  }

  console.log('Seed listo. Credenciales:', { email, password });
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
