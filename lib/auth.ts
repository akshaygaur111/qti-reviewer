/**
 * Auth utilities — JWT signing / verification + password hashing.
 *
 * Session is stored in an httpOnly cookie named "qti_session".
 * JWT is signed with the JWT_SECRET environment variable.
 *
 * On first boot (if the users collection is empty and ADMIN_USERNAME /
 * ADMIN_PASSWORD env vars are set) a default admin account is seeded
 * automatically.
 */

import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import type { NextRequest } from "next/server";

export const SESSION_COOKIE = "qti_session";
const JWT_EXPIRY = "7d";

export interface SessionUser {
  id: string;
  username: string;
  role: "admin" | "user";
}

// ---------------------------------------------------------------------------
// JWT
// ---------------------------------------------------------------------------

function jwtSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET environment variable is not set.");
  return s;
}

export function signToken(user: SessionUser): string {
  return jwt.sign(user, jwtSecret(), { expiresIn: JWT_EXPIRY });
}

export function verifyToken(token: string): SessionUser | null {
  try {
    return jwt.verify(token, jwtSecret()) as SessionUser;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Password hashing
// ---------------------------------------------------------------------------

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

/** Extract the session user from a Next.js request (returns null if not authed). */
export function getSessionUser(req: NextRequest): SessionUser | null {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifyToken(token);
}

/**
 * Require authentication. Returns the session user or null.
 * API route handlers should check for null and return 401.
 */
export function requireAuth(req: NextRequest): SessionUser | null {
  return getSessionUser(req);
}

/** Require admin role. Returns null if not authed or not admin. */
export function requireAdmin(req: NextRequest): SessionUser | null {
  const user = getSessionUser(req);
  if (!user || user.role !== "admin") return null;
  return user;
}
