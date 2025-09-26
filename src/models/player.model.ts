import { Schema, model, type Document } from 'mongoose'
import { isAbilityKey } from '../constants/abilities.js'

export interface PlayerDoc extends Document {
  name: string
  nickname?: string
  abilities?: Map<string, number>
  rating?: number
  createdAt: Date
  updatedAt: Date
}

const PlayerSchema = new Schema<PlayerDoc>(
  {
    name: { type: String, required: true, trim: true },
    nickname: { type: String, trim: true },
    abilities: {
      type: Map,
      of: { type: Number, min: 1, max: 10 },
      default: undefined,
      validate: {
        validator(value?: Map<string, number>) {
          if (!value) return true
          for (const [k, v] of value.entries()) {
            if (!isAbilityKey(k)) return false
            if (typeof v !== 'number' || v < 1 || v > 10) return false
          }
          return true
        },
        message: 'Invalid abilities payload',
      },
    },
    rating: { type: Number, default: 1000 },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: { virtuals: true, getters: true, flattenMaps: true },
    toObject: { virtuals: true, getters: true, flattenMaps: true },
  }
)

export const Player = model<PlayerDoc>('Player', PlayerSchema)
