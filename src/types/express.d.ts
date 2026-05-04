import 'express-serve-static-core';

declare module 'express-serve-static-core' {
  interface Request {
    userId?: string;
    spaceId?: string;
  }
}

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userEmail?: string;
      spaceId?: string;
    }
  }
}
