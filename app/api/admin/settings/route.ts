import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requireAdmin } from "@/lib/auth";
import { getSettings, updateSettings } from "@/lib/db";

/** GET /api/admin/settings — any logged-in user can read the active model */
export async function GET(req: NextRequest) {
  if (!requireAuth(req)) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  const settings = await getSettings();
  return NextResponse.json({ active_model: settings.active_model });
}

/** PUT /api/admin/settings — only admins can change the model */
export async function PUT(req: NextRequest) {
  const admin = requireAdmin(req);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { active_model?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { active_model } = body;
  if (!active_model || typeof active_model !== "string") {
    return NextResponse.json({ error: "active_model is required" }, { status: 400 });
  }

  const ok = await updateSettings(active_model.trim(), admin.id);
  return ok
    ? NextResponse.json({ ok: true, active_model })
    : NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
}
