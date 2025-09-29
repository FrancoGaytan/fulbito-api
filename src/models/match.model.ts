import { Schema, model, Document, Types } from 'mongoose';

export interface IMatchTeam {
  name: string;
  players: Types.ObjectId[];
  score: number;
}

export interface IMatchFeedback {
  playerId: Types.ObjectId;
  vote: 'up' | 'neutral' | 'down';
  note?: string;
  by: Types.ObjectId;
  at: Date;
}

export interface IMatchResult {
  scoreA: number;
  scoreB: number;
  finalizedAt: Date;
}

export interface IMatch extends Document {
  groupId: Types.ObjectId;
  participants: Types.ObjectId[];
  teams: IMatchTeam[];
  feedback: IMatchFeedback[];
  result?: IMatchResult;
  status: 'pending' | 'ongoing' | 'finalized';
  owner: Types.ObjectId;
  scheduledAt?: Date;
  ratingApplied?: boolean;
  ratingChanges?: {
    playerId: Types.ObjectId;
    before: number;
    after: number;
    delta: number;
  }[];
  createdAt: Date;
  updatedAt: Date;
}

const matchTeamSchema = new Schema<IMatchTeam>(
  {
    name: { type: String, required: true },
    players: [{ type: Schema.Types.ObjectId, ref: 'Player', required: true }],
    score: { type: Number, default: 0 },
  },
  { _id: false },
);

const matchFeedbackSchema = new Schema<IMatchFeedback>(
  {
    playerId: { type: Schema.Types.ObjectId, ref: 'Player', required: true },
    vote: { type: String, enum: ['up', 'neutral', 'down'], required: true },
    note: { type: String },
    by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    at: { type: Date, required: true },
  },
  { _id: false },
);

const matchResultSchema = new Schema<IMatchResult>(
  {
    scoreA: { type: Number, required: true },
    scoreB: { type: Number, required: true },
    finalizedAt: { type: Date, required: true },
  },
  { _id: false },
);

const matchSchema = new Schema<IMatch>(
  {
    groupId: { type: Schema.Types.ObjectId, ref: 'Group', required: true },
    participants: [{ type: Schema.Types.ObjectId, ref: 'Player', default: [] }],
    teams: { type: [matchTeamSchema], default: [] },
    feedback: { type: [matchFeedbackSchema], default: [] },
    result: { type: matchResultSchema, required: false },
    status: {
      type: String,
      enum: ['pending', 'ongoing', 'finalized'],
      default: 'pending',
    },
    owner: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    scheduledAt: { type: Date },
    ratingApplied: { type: Boolean, default: false },
    ratingChanges: {
      type: [
        new Schema(
          {
            playerId: { type: Schema.Types.ObjectId, ref: 'Player', required: true },
            before: { type: Number, required: true },
            after: { type: Number, required: true },
            delta: { type: Number, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  { timestamps: true },
);

export const Match = model<IMatch>('Match', matchSchema);
