import { NextRequest, NextResponse } from "next/server";
import { signToken, verifyPassword, SESSION_COOKIE } from "@/lib/auth";
import { findUserByUsername, ensureDefaultAdmin } from "@/lib/db";

export async function POST(req: NextRequest) {
  // Seed default admin on first call if DB is empty
  await ensureDefaultAdmin();

  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { username, password } = body;
  if (!username || !password) {
    return NextResponse.json({ error: "username and password are required" }, { status: 400 });
  }

  const user = await findUserByUsername(username.trim().toLowerCase());
  if (!user) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const ok = await verifyPassword(password, user.password);
  if (!ok) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const token = signToken({ id: user._id, username: user.username, role: user.role });

  const res = NextResponse.json({
    id: user._id,
    username: user.username,
    role: user.role,
  });

  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,  // 7 days
    secure: process.env.NODE_ENV === "production",
  });

  return res;
}
