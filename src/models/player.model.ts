import {
  Schema,
  model,
  InferSchemaType,
  HydratedDocument,
  Types,
  Document,
} from 'mongoose';

export interface IPlayer extends Document {
  name: string;
  abilities: string[];
  rating: number;
  ratingHistory: any[];
  skillHistory: any[];
  owner: Types.ObjectId;
}

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
  { _id: false },
);

// historial de cambios de habilidades (auto o manual) por match
const skillChangeSchema = new Schema(
  {
    match: { type: Schema.Types.ObjectId, ref: 'Match' },
    changes: [{ key: { type: String }, old: Number, new: Number }],
    reason: { type: String, enum: ['auto', 'manual'], default: 'auto' },
  },
  { _id: false, timestamps: { createdAt: true, updatedAt: false } },
);

const playerSchema = new Schema<IPlayer>({
  name: { type: String, required: true, trim: true },
  abilities: [{ type: String }],
  rating: { type: Number, default: 1000 },
  ratingHistory: [{ type: Schema.Types.Mixed }],
  skillHistory: [{ type: Schema.Types.Mixed }],
  owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
}, { timestamps: true });

export type Player = InferSchemaType<typeof playerSchema> & {
  createdAt: Date;
  updatedAt: Date;
};
export type PlayerDoc = HydratedDocument<Player>;

export const Player = model<IPlayer>('Player', playerSchema);
