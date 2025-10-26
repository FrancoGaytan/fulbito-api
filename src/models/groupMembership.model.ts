import { Schema, model, type Document, Types } from 'mongoose';

export interface GroupMembershipDoc extends Document {
  groupId: Types.ObjectId;
  playerId: Types.ObjectId;
  rating: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  abilityOverrides?: Map<string, number>;
  role: 'member' | 'admin' | 'owner';
  status: 'active' | 'invited' | 'inactive';
  joinedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const GroupMembershipSchema = new Schema<GroupMembershipDoc>({
  groupId: { type: Schema.Types.ObjectId, ref: 'Group', required: true, index: true },
  playerId: { type: Schema.Types.ObjectId, ref: 'Player', required: true, index: true },
  rating: { type: Number, default: 1000 },
  gamesPlayed: { type: Number, default: 0 },
  wins: { type: Number, default: 0 },
  losses: { type: Number, default: 0 },
  draws: { type: Number, default: 0 },
  abilityOverrides: { type: Map, of: Number, default: undefined },
  role: { type: String, enum: ['member','admin','owner'], default: 'member' },
  status: { type: String, enum: ['active','invited','inactive'], default: 'active' },
  joinedAt: { type: Date, default: Date.now }
}, {
  timestamps: true,
  versionKey: false,
  toJSON: { virtuals: true, getters: true, flattenMaps: true },
  toObject: { virtuals: true, getters: true, flattenMaps: true }
});

GroupMembershipSchema.index({ groupId: 1, playerId: 1 }, { unique: true });

export const GroupMembership = model<GroupMembershipDoc>('GroupMembership', GroupMembershipSchema);
