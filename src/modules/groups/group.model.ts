import { Schema, model, Types } from 'mongoose';

export interface Group {
  _id: Types.ObjectId;
  name: string;
  ownerUserId?: Types.ObjectId; // lo usamos cuando tengamos login
  members: Types.ObjectId[];    // refs a Player
  inviteCode?: string;          // opcional para unirse
  createdAt: Date;
  updatedAt: Date;
}

const groupSchema = new Schema<Group>(
  {
    name: { type: String, required: true, trim: true },
    ownerUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    members: [{ type: Schema.Types.ObjectId, ref: 'Player', index: true }],
    inviteCode: { type: String },
  },
  { timestamps: true },
);

// índice para búsquedas por nombre del grupo (listado)
groupSchema.index({ name: 1 });

export const GroupModel = model<Group>('Group', groupSchema);
