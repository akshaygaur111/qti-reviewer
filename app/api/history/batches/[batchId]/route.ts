import { NextRequest, NextResponse } from "next/server";
import { getBatch, getBatchResults } from "@/lib/db";

// GET /api/history/batches/[batchId] — batch metadata + all results
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const { batchId } = await params;
  const [batch, results] = await Promise.all([
    getBatch(batchId),
    getBatchResults(batchId),
  ]);
  if (!batch) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }
  return NextResponse.json({ batch, results });
}
