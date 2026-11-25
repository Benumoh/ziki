import type { AppRole } from "@/lib/roles";
import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: AppRole;
      /** User.sessionVersion when this session was issued (#208). */
      sessionVersion?: number;
      /** UserSession.id when issued with per-session tracking. */
      sessionId?: string;
      authenticationMethod?: "google" | "credentials";
      authenticatedAt?: number;
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    role?: AppRole;
    sessionVersion?: number;
    sessionId?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: AppRole;
    /** User.sessionVersion at sign-in (#208). */
    sv?: number;
    /** UserSession.id at sign-in. */
    sid?: string;
    authenticationMethod?: "google" | "credentials";
    authenticatedAt?: number;
  }
}
