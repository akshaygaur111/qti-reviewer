import { NextRequest, NextResponse } from "next/server";
import { parseQTIXml } from "@/lib/parser";
import { QTIReviewer } from "@/lib/reviewer";
import type { BulkReviewRequest, BulkReviewResponse, ReviewResult } from "@/lib/types";

export const maxDuration = 60; // seconds per Vercel function call
// Note: for large batches the UI calls /api/review per item client-side.
// This endpoint is kept for programmatic / API consumers with small batches.

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY is not configured on the server." },
      { status: 500 }
    );
  }

  let body: BulkReviewRequest;
  try {
    body = (await req.json()) as BulkReviewRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json(
      { error: "Request body must contain a non-empty 'items' array." },
      { status: 400 }
    );
  }

  const reviewer = new QTIReviewer(apiKey);
  const results: ReviewResult[] = [];

  for (const item of body.items) {
    if (!item.xml || typeof item.xml !== "string") {
      results.push({
        itemIdentifier: "",
        itemTitle: item.fileName ?? "unknown",
        fileName: item.fileName ?? "unknown.xml",
        overallScore: 0,
        overallSummary: "",
        categoryScores: [],
        issues: [],
        strengths: [],
        modelUsed: "",
        error: "Missing or invalid xml field.",
      });
      continue;
    }

    try {
      const summary = parseQTIXml(item.xml, item.fileName);
      const result = await reviewer.reviewItem(summary, item.xml, item.fileName);
      results.push(result);
    } catch (err) {
      results.push({
        itemIdentifier: "",
        itemTitle: item.fileName,
        fileName: item.fileName,
        overallScore: 0,
        overallSummary: "",
        categoryScores: [],
        issues: [],
        strengths: [],
        modelUsed: "",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const succeeded = results.filter((r) => !r.error);
  const avgScore =
    succeeded.length > 0
      ? Math.round(
          (succeeded.reduce((s, r) => s + r.overallScore, 0) / succeeded.length) * 100
        ) / 100
      : 0;

  const response: BulkReviewResponse = {
    results,
    summary: {
      total: results.length,
      succeeded: succeeded.length,
      failed: results.filter((r) => !!r.error).length,
      averageScore: avgScore,
      criticalIssueCount: succeeded.reduce(
        (count, r) =>
          count + r.issues.filter((i) => i.severity === "critical").length,
        0
      ),
    },
  };

  return NextResponse.json(response);
}
