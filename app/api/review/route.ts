import { NextRequest, NextResponse } from "next/server";
import { parseQTIXml } from "@/lib/parser";
import { QTIReviewer } from "@/lib/reviewer";
import type { ReviewRequest } from "@/lib/types";

export const maxDuration = 60; // seconds (Vercel Pro: 300)

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY is not configured on the server." },
      { status: 500 }
    );
  }

  let body: ReviewRequest;
  try {
    body = (await req.json()) as ReviewRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.xml || typeof body.xml !== "string" || body.xml.trim().length === 0) {
    return NextResponse.json(
      { error: "Request body must contain a non-empty 'xml' string." },
      { status: 400 }
    );
  }

  const fileName = body.fileName ?? "item.xml";

  try {
    const summary = parseQTIXml(body.xml, fileName);
    const reviewer = new QTIReviewer(apiKey);
    const result = await reviewer.reviewItem(summary, body.xml, fileName);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
