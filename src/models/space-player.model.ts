import { Schema, model, Document, Types } from 'mongoose';
import { isAbilityKey } from '../constants/abilities.js';

/**
 * SpacePlayer — perfil de jugador dentro de un Space específico.
 * Reemplaza al Player global: rating, abilities y gamesPlayed son por-space.
 * El userId es el User autenticado que "es" este perfil en el space.
 */
export interface ISpacePlayer extends Document {
  spaceId: Types.ObjectId;
  userId: Types.ObjectId;       // User dueño del perfil
  name: string;
  nickname?: string;
  abilities?: Map<string, number>;
  rating: number;
  gamesPlayed: number;
  createdAt: Date;
  updatedAt: Date;
}

const spacePlayerSchema = new Schema<ISpacePlayer>(
  {
    spaceId: { type: Schema.Types.ObjectId, ref: 'Space', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true },
    nickname: { type: String, trim: true },
    abilities: {
      type: Map,
      of: { type: Number, min: 1, max: 10 },
      default: undefined,
      validate: {
        validator(value?: Map<string, number>) {
          if (!value) return true;
          for (const [k, v] of value.entries()) {
            if (!isAbilityKey(k)) return false;
            if (typeof v !== 'number' || v < 1 || v > 10) return false;
          }
          return true;
        },
        message: 'Invalid abilities payload',
      },
    },
    rating: { type: Number, default: 1000 },
    gamesPlayed: { type: Number, default: 0, min: 0 },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: { virtuals: true, getters: true, flattenMaps: true },
    toObject: { virtuals: true, getters: true, flattenMaps: true },
  },
);

// Un usuario sólo puede tener un perfil por space
spacePlayerSchema.index({ spaceId: 1, userId: 1 }, { unique: true });

export const SpacePlayer = model<ISpacePlayer>('SpacePlayer', spacePlayerSchema);
