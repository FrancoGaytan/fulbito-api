import { Schema, model, Document, Types } from 'mongoose';

export interface IGroup extends Document {
  name: string;
  members: Types.ObjectId[];
  owner: Types.ObjectId;
  spaceId?: Types.ObjectId;    // optional during migration; required going forward
  createdAt: Date;
  updatedAt: Date;
}

const groupSchema = new Schema<IGroup>({
  name: { type: String, required: true, trim: true },
  members: [{ type: Schema.Types.ObjectId, ref: 'Player' }],
  owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  spaceId: { type: Schema.Types.ObjectId, ref: 'Space', index: true, default: null },
}, { timestamps: true });

export const Group = model<IGroup>('Group', groupSchema);
