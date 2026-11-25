import type { AuthContext } from "../auth/sessions.js";

declare global {
  namespace Express {
    interface Request {
      /** Set by the session middleware when the request carries a live session. */
      auth?: AuthContext;
    }
  }
}

export {};
