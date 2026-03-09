import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { hashPassword } from "@/lib/auth";
import { createUser, listUsers, deleteUser } from "@/lib/db";

/** GET /api/admin/users — list all users (admin only) */
export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const users = await listUsers();
  return NextResponse.json(users);
}

/** POST /api/admin/users — create a new user (admin only) */
export async function POST(req: NextRequest) {
  const admin = requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { username?: string; password?: string; role?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { username, password, role } = body;
  if (!username || !password) {
    return NextResponse.json({ error: "username and password are required" }, { status: 400 });
  }
  if (role && role !== "admin" && role !== "user") {
    return NextResponse.json({ error: "role must be 'admin' or 'user'" }, { status: 400 });
  }

  const hash = await hashPassword(password);
  const ok = await createUser({
    _id: crypto.randomUUID(),
    username: username.trim().toLowerCase(),
    password: hash,
    role: (role as "admin" | "user") ?? "user",
    created_by: admin.id,
  });

  if (!ok) {
    return NextResponse.json(
      { error: "Failed to create user — username may already exist." },
      { status: 409 }
    );
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}

/** DELETE /api/admin/users?id=… — delete a user (admin only) */
export async function DELETE(req: NextRequest) {
  const admin = requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id query param required" }, { status: 400 });
  if (id === admin.id) {
    return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
  }

  const ok = await deleteUser(id);
  return ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: "User not found" }, { status: 404 });
}
