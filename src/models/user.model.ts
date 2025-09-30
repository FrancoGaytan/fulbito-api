import { Schema, model, Document } from 'mongoose';

export interface IUser extends Document {
  email: string;
  passwordHash: string;
  resetCodeHash?: string | null;
  resetCodeExpires?: Date | null;
  passwordResetSessionToken?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>({
  email: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  resetCodeHash: { type: String, required: false, default: null },
  resetCodeExpires: { type: Date, required: false, default: null },
  passwordResetSessionToken: { type: String, required: false, default: null },
}, { timestamps: true });

export const User = model<IUser>('User', userSchema);
