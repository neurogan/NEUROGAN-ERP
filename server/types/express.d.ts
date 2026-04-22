// Augment Express's Request with the authenticated user shape. Referenced
// globally via the Express.Request namespace so every route handler and
// middleware sees req.user typed. Population happens in F-02's session
// deserialization; F-01's middleware in server/auth/middleware.ts reads this
// augmentation.

import type { UserRole, UserStatus } from "@shared/schema";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        roles: UserRole[];
        status: UserStatus;
      };
    }
  }
}

export {};
