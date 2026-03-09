import { NextRequest, NextResponse } from "next/server";
import { parseQTIXml } from "@/lib/parser";
import { QTIReviewer } from "@/lib/reviewer";
import { saveResult, getSettings } from "@/lib/db";
import { fetchAlphaItemXml } from "@/lib/alpha-api";
import type { ReviewRequest } from "@/lib/types";

export const maxDuration = 60;

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

  // Resolve XML content — from inline string, remote URL, or alpha API item ID
  let xml = body.xml ?? "";
  if (!xml && body.xmlUrl) {
    try {
      const res = await fetch(body.xmlUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      xml = await res.text();
    } catch (err) {
      return NextResponse.json(
        { error: `Failed to fetch XML from URL: ${err instanceof Error ? err.message : err}` },
        { status: 400 }
      );
    }
  }

  if (!xml && body.itemId) {
    try {
      xml = await fetchAlphaItemXml(body.itemId);
    } catch (err) {
      return NextResponse.json(
        { error: `Failed to fetch item from alpha API: ${err instanceof Error ? err.message : err}` },
        { status: 400 }
      );
    }
  }

  if (!xml.trim()) {
    return NextResponse.json(
      { error: "Request body must contain a non-empty 'xml', 'xmlUrl', or 'itemId'." },
      { status: 400 }
    );
  }

  const fileName =
    body.fileName ??
    (body.itemId ? `item-${body.itemId}.xml` : body.xmlUrl?.split("/").pop() ?? "item.xml");

  // Model is set globally by admin — ignore any client-supplied model
  const settings = await getSettings();
  const model = settings.active_model;

  try {
    const summary = parseQTIXml(xml, fileName);
    const reviewer = new QTIReviewer(apiKey, model);
    const result = await reviewer.reviewItem(summary, xml, fileName);

    // Carry the alpha API item ID forward so the client can call process-response
    if (body.itemId) {
      result.sourceItemId = body.itemId;
    }

    // Persist to DB (no-op if DATABASE_URL not set)
    if (body.batchId) {
      await saveResult(body.batchId, result);
    }

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
