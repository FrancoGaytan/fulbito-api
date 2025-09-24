import { Schema, model, Document, Types } from 'mongoose';

export interface IGroup extends Document {
  name: string;
  members: Types.ObjectId[];
  owner: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const groupSchema = new Schema<IGroup>({
  name: { type: String, required: true, trim: true },
  members: [{ type: Schema.Types.ObjectId, ref: 'Player' }],
  owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

export const Group = model<IGroup>('Group', groupSchema);
