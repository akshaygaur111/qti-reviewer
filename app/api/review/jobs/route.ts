import { NextRequest, NextResponse } from "next/server";
import { createJob, updateJobProgress, updateBatchSummary, getBatchResults, getJob, listActiveJobs, updateJobStatus } from "@/lib/db";
import { runReviewOrchestration } from "@/lib/review-orchestrator";
import type { ReviewRequest, ReviewResult } from "@/lib/types";

export const maxDuration = 300; // 5 minutes (max for Vercel Hobby/Pro, but Render is persistent)

/**
 * GET /api/review/jobs?id=...
 * Returns the status and progress of a background job.
 * If no ID is provided, returns all active jobs.
 */
export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get("id");

    if (!jobId) {
        const activeJobs = await listActiveJobs();
        return NextResponse.json({ activeJobs });
    }

    const job = await getJob(jobId);
    if (!job) {
        return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    return NextResponse.json(job);
}

/**
 * DELETE /api/review/jobs?id=...
 * Cancels a running job.
 */
export async function DELETE(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get("id");

    if (!jobId) {
        return NextResponse.json({ error: "Missing job ID" }, { status: 400 });
    }

    await updateJobStatus(jobId, "failed"); // we treat cancellation as "failed" / "cancelled"
    return NextResponse.json({ success: true });
}

/**
 * POST /api/review/jobs
 * Starts a background bulk review job.
 */
export async function POST(req: NextRequest) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
    }

    let body: { batchId: string; items: ReviewRequest[] };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const { batchId, items } = body;
    if (!batchId || !items || !Array.isArray(items)) {
        return NextResponse.json({ error: "Missing batchId or items array" }, { status: 400 });
    }

    const jobId = crypto.randomUUID();
    const ok = await createJob(jobId, batchId, items.length);
    if (!ok) {
        return NextResponse.json({ error: "Failed to create job in database" }, { status: 500 });
    }

    // Kick off background processing (intentional no-await)
    // This works on persistent servers like Render.
    processBatch(jobId, batchId, items, apiKey).catch(err => {
        console.error(`[Job ${jobId}] Critical failure:`, err);
    });

    return NextResponse.json({ jobId });
}

/**
 * Internal background loop.
 */
async function processBatch(
    jobId: string,
    batchId: string,
    items: ReviewRequest[],
    apiKey: string
) {
    console.log(`[Job ${jobId}] Starting processing of ${items.length} items...`);

    const results: ReviewResult[] = [];

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const fileName = item.fileName ?? "unknown";

        // Double check if job was cancelled
        const currentJob = await getJob(jobId);
        if (currentJob?.status === "failed") {
            console.log(`[Job ${jobId}] Cancellation detected. Stopping.`);
            return;
        }

        // Update progress
        await updateJobProgress(jobId, {
            current: i,
            total: items.length,
            currentFileName: fileName,
        }, "running");

        try {
            const result = await runReviewOrchestration({ ...item, batchId }, apiKey);
            results.push(result);
        } catch (err) {
            console.error(`[Job ${jobId}] Item ${i} (${fileName}) failed:`, err);
            results.push({
                itemIdentifier: "",
                itemTitle: fileName,
                fileName: fileName,
                overallScore: 0,
                overallSummary: "",
                issues: [],
                modelUsed: "",
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }

    // Finalize batch summary
    const summary = buildBulkSummary(results);
    await updateBatchSummary(batchId, summary);

    // Mark job as completed
    await updateJobProgress(jobId, {
        current: items.length,
        total: items.length,
        currentFileName: "Done",
    }, "completed");

    console.log(`[Job ${jobId}] Completed successfully.`);
}

function buildBulkSummary(results: ReviewResult[]) {
    const succeeded = results.filter((r) => !r.error);
    return {
        total: results.length,
        succeeded: succeeded.length,
        failed: results.filter((r) => !!r.error).length,
        averageScore:
            succeeded.length > 0
                ? Math.round((succeeded.reduce((s, r) => s + r.overallScore, 0) / succeeded.length) * 100) / 100
                : 0,
        criticalIssueCount: succeeded.reduce(
            (count, r) => count + r.issues.filter((i) => i.severity === "critical").length, 0
        ),
    };
}
