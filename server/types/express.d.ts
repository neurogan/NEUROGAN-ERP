// Augment Express's User interface (picked up by Passport's req.user typing)
// with the authenticated user shape. Passport declares req.user as
// Express.User | undefined; by extending Express.User here, all req.user
// accesses throughout the server get the correct type without needing
// separate per-module augmentations.
//
// Population happens in F-02's passport.deserializeUser. F-01's middleware
// in server/auth/middleware.ts reads this augmentation.

import type { UserRole, UserStatus } from "@shared/schema";

declare global {
  namespace Express {
    interface User {
      id: string;
      email: string;
      roles: UserRole[];
      status: UserStatus;
    }
    // F-03: UUID generated per-request by the requestId middleware in server/index.ts.
    // Propagated into every audit row so related log lines can be correlated.
    interface Request {
      requestId: string;
    }
  }
}

export {};
