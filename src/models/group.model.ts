import { Schema, model, Document, Types } from 'mongoose';

export interface IGroup extends Document {
  name: string;
  members: Types.ObjectId[];
  owner: Types.ObjectId;
  joinCode?: string;
  joinCodeUpdatedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const groupSchema = new Schema<IGroup>({
  name: { type: String, required: true, trim: true },
  members: [{ type: Schema.Types.ObjectId, ref: 'Player' }],
  owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  // joinCode ahora único y normalizado en mayúsculas para permitir join sólo por código
  joinCode: { 
    type: String, 
    index: true, 
    unique: true, 
    trim: true,
    set: (v: string) => (typeof v === 'string' ? v.toUpperCase() : v)
  },
  joinCodeUpdatedAt: { type: Date }
}, { timestamps: true });

export const Group = model<IGroup>('Group', groupSchema);
