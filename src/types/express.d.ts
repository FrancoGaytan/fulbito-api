import 'express-serve-static-core';

declare module 'express-serve-static-core' {
  interface Request {
    userId?: string;
  }
}

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userEmail?: string;
      groupContext?: {
        groupId: string;
        isOwner: boolean;
        isMember: boolean;
        myPlayerId: string | null;
        membership: any;
      };
    }
  }
}
