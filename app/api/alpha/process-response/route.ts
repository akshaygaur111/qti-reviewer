import { NextRequest, NextResponse } from "next/server";
import { processAlphaItemResponse } from "@/lib/alpha-api";

export const maxDuration = 30;

// POST /api/alpha/process-response
// Body: { itemId: string; responses: unknown }
// Proxies to the alpha-1edtech process-response endpoint (keeps token server-side).
export async function POST(req: NextRequest) {
  let body: { itemId?: string; responses?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.itemId) {
    return NextResponse.json({ error: "itemId is required." }, { status: 400 });
  }

  try {
    const result = await processAlphaItemResponse(body.itemId, body.responses ?? {});
    return NextResponse.json({ result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
