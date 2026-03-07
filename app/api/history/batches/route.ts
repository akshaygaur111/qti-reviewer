import { NextRequest, NextResponse } from "next/server";
import { createBatch, listBatches, updateBatchSummary, dbAvailable } from "@/lib/db";
import type { BulkReviewResponse } from "@/lib/types";

// GET /api/history/batches — list all batches
export async function GET() {
  if (!dbAvailable()) {
    return NextResponse.json({ batches: [], dbAvailable: false });
  }
  const batches = await listBatches();
  return NextResponse.json({ batches, dbAvailable: true });
}

// POST /api/history/batches — create a new batch, returns { batchId }
export async function POST(req: NextRequest) {
  if (!dbAvailable()) {
    return NextResponse.json({ batchId: null, dbAvailable: false });
  }
  const body = (await req.json()) as { name?: string };
  const batchId = crypto.randomUUID();
  const name = body.name ?? `Batch ${new Date().toLocaleString()}`;
  await createBatch(batchId, name);
  return NextResponse.json({ batchId, dbAvailable: true });
}

// PATCH /api/history/batches — update summary after run completes
export async function PATCH(req: NextRequest) {
  if (!dbAvailable()) return NextResponse.json({ ok: true });
  const body = (await req.json()) as { batchId: string; summary: BulkReviewResponse["summary"] };
  if (body.batchId && body.summary) {
    await updateBatchSummary(body.batchId, body.summary);
  }
  return NextResponse.json({ ok: true });
}
