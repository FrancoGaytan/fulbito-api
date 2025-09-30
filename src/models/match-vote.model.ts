import { Schema, model, type Document, Types } from 'mongoose';

export interface MatchPlayerVoteDoc extends Document {
  matchId: Types.ObjectId;
  playerId: Types.ObjectId;
  voterUserId: Types.ObjectId;
  vote: 'up' | 'neutral' | 'down';
  note?: string;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<MatchPlayerVoteDoc>({
  matchId: { type: Schema.Types.ObjectId, ref: 'Match', required: true, index: true },
  playerId: { type: Schema.Types.ObjectId, ref: 'Player', required: true },
  voterUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  vote: { type: String, enum: ['up', 'neutral', 'down'], required: true },
  note: { type: String, trim: true },
}, { timestamps: true });

schema.index({ matchId: 1, voterUserId: 1, playerId: 1 }, { unique: true });
schema.index({ matchId: 1, playerId: 1 });

export const MatchPlayerVote = model<MatchPlayerVoteDoc>('MatchPlayerVote', schema);