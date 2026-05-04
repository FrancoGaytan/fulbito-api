import { Schema, model, Document, Types } from 'mongoose';

/**
 * SpaceMembership — relación User <-> Space.
 * Un user puede pertenecer a N spaces con rol 'admin' | 'member'.
 * El currentSpaceId del usuario se guarda en el token / localStorage del front.
 */
export interface ISpaceMembership extends Document {
  spaceId: Types.ObjectId;
  userId: Types.ObjectId;
  role: 'admin' | 'member';
  joinedAt: Date;
}

const spaceMembershipSchema = new Schema<ISpaceMembership>(
  {
    spaceId: { type: Schema.Types.ObjectId, ref: 'Space', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    role: { type: String, enum: ['admin', 'member'], default: 'member' },
    joinedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: false },
);

// Un usuario sólo puede estar una vez por space
spaceMembershipSchema.index({ spaceId: 1, userId: 1 }, { unique: true });

export const SpaceMembership = model<ISpaceMembership>('SpaceMembership', spaceMembershipSchema);
