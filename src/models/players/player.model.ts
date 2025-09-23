import { Schema, model, InferSchemaType, HydratedDocument } from 'mongoose';

// 🔁 Exportamos las keys para reusar en validaciones si hace falta
export const abilityKeys = [
  'goalkeeper',
  'running',
  'passes',
  'defense',
  'power',
  'scorer',
  'positionalUnderstanding',
] as const;
type AbilityKey = (typeof abilityKeys)[number];

const abilitySchema = new Schema(
  {
    key: { type: String, enum: abilityKeys, required: true },
    value: { type: Number, min: 0, max: 10, required: true },
  },
  { _id: false }
);

// historial de cambios de habilidades (auto o manual) por match
const skillChangeSchema = new Schema(
  {
    match: { type: Schema.Types.ObjectId, ref: 'Match' },
    changes: [{ key: { type: String }, old: Number, new: Number }],
    reason: { type: String, enum: ['auto', 'manual'], default: 'auto' },
  },
  { _id: false, timestamps: { createdAt: true, updatedAt: false } }
);

const playerSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    abilities: { type: [abilitySchema], default: [] },

    // ⭐️ Nuevos campos para aprendizaje
    rating: { type: Number, default: 1000 }, // ELO simple
    ratingHistory: [
      {
        match: { type: Schema.Types.ObjectId, ref: 'Match' },
        old: Number,
        new: Number,
        _id: false,
      },
    ],
    skillHistory: { type: [skillChangeSchema], default: [] },
  },
  { timestamps: true }
);

export type Player = InferSchemaType<typeof playerSchema> & {
  createdAt: Date;
  updatedAt: Date;
};
export type PlayerDoc = HydratedDocument<Player>;

export const PlayerModel = model<Player>('Player', playerSchema);
