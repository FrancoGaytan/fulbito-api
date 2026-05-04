import { Schema, model, Document, Types } from 'mongoose';

/**
 * Space — tenant/container superior a los grupos.
 * Un Space tiene un admin (owner) y se puede unir con inviteCode.
 */
export interface ISpace extends Document {
  name: string;
  description?: string;
  owner: Types.ObjectId;       // User que creó el space (admin)
  inviteCode: string;          // Código único de invitación (6 chars uppercase)
  createdAt: Date;
  updatedAt: Date;
}

const spaceSchema = new Schema<ISpace>(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    inviteCode: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
  },
  { timestamps: true },
);

export const Space = model<ISpace>('Space', spaceSchema);
