import { Schema, model, Types } from 'mongoose';

export interface IMatchTeam {
  name: 'A' | 'B';
  players: Types.ObjectId[];
  score: number;
}

export interface IMatchFeedback {
  player: Types.ObjectId;
  vote: -1 | 0 | 1;
  note?: string | null;
}

export interface IMatch {
  group: Types.ObjectId;
  participants: Types.ObjectId[];
  teams: IMatchTeam[];
  feedback: IMatchFeedback[];
  status: 'draft' | 'generated' | 'finalized';
  result?: { winner: 'A' | 'B' | 'draw'; scoreA: number; scoreB: number };
}

const teamSchema = new Schema<IMatchTeam>(
  {
    name: { type: String, enum: ['A', 'B'], required: true },
    players: [{ type: Schema.Types.ObjectId, ref: 'Player', required: true }],
    score: { type: Number, default: 0 },
  },
  { _id: false }
);

const feedbackSchema = new Schema<IMatchFeedback>(
  {
    player: { type: Schema.Types.ObjectId, ref: 'Player', required: true },
    vote: { type: Number, enum: [-1, 0, 1], required: true },
    note: { type: String, default: null },
  },
  { _id: false }
);

const matchSchema = new Schema<IMatch>(
  {
    group: { type: Schema.Types.ObjectId, ref: 'Group', required: true, index: true },
    participants: [{ type: Schema.Types.ObjectId, ref: 'Player', required: true }],
    teams: { type: [teamSchema], default: [] as unknown as IMatchTeam[] },
    feedback: { type: [feedbackSchema], default: [] as unknown as IMatchFeedback[] },
    status: { type: String, enum: ['draft', 'generated', 'finalized'], default: 'draft' },
    result: {
      winner: { type: String, enum: ['A', 'B', 'draw'] },
      scoreA: Number,
      scoreB: Number,
    },
  },
  { timestamps: true }
);

export const MatchModel = model<IMatch>('Match', matchSchema);
