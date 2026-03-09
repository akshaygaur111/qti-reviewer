import { parseQTIXml } from "./parser";
import { QTIReviewer } from "./reviewer";
import { saveResult, getSettings } from "./db";
import { fetchAlphaItemXml, processAlphaItemResponse } from "./alpha-api";
import type { ReviewRequest, ReviewResult } from "./types";

/**
 * Shared orchestration logic for a single item review.
 * Used by both the synchronous API and background job processor.
 */
export async function runReviewOrchestration(
    body: ReviewRequest,
    apiKey: string
): Promise<ReviewResult> {
    // Resolve XML content — from inline string, remote URL, or alpha API item ID
    let xml = body.xml ?? "";
    if (!xml && body.xmlUrl) {
        try {
            const res = await fetch(body.xmlUrl);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            xml = await res.text();
        } catch (err) {
            throw new Error(`Failed to fetch XML from URL: ${err instanceof Error ? err.message : err}`);
        }
    }

    if (!xml && body.itemId) {
        try {
            xml = await fetchAlphaItemXml(body.itemId);
        } catch (err) {
            throw new Error(`Failed to fetch item from alpha API: ${err instanceof Error ? err.message : err}`);
        }
    }

    if (!xml.trim()) {
        throw new Error("Request body must contain a non-empty 'xml', 'xmlUrl', or 'itemId'.");
    }

    const fileName =
        body.fileName ??
        (body.itemId ? `item-${body.itemId}.xml` : body.xmlUrl?.split("/").pop() ?? "item.xml");

    // Model is set globally by admin — ignore any client-supplied model
    const settings = await getSettings();
    const model = settings.active_model;

    const summary = parseQTIXml(xml, fileName);
    const reviewer = new QTIReviewer(apiKey, model);
    const result = await reviewer.reviewItem(summary, xml, fileName);

    // Carry the alpha API item ID forward
    if (body.itemId) {
        result.sourceItemId = body.itemId;

        // Orchestrate Behavioral Testing
        const alphaConfigured = Boolean(process.env.ALPHA1_CLIENT_ID && process.env.ALPHA1_CLIENT_SECRET);
        if (alphaConfigured && result.behavioralTests && result.behavioralTests.length > 0) {
            const testResults = await Promise.all(
                result.behavioralTests.map(async (test) => {
                    try {
                        const apiResponse = await processAlphaItemResponse(body.itemId!, test.payload) as any;

                        const actualScore = apiResponse?.score !== undefined ? Number(apiResponse.score) : undefined;
                        const actualIsCorrect = apiResponse?.isCorrect !== undefined ? Boolean(apiResponse.isCorrect) : undefined;

                        let status: "pass" | "fail" | "error" = "pass";
                        let errorMsg = "";

                        if (test.expectedIsCorrect !== undefined && actualIsCorrect !== test.expectedIsCorrect) {
                            status = "fail";
                            errorMsg += `isCorrect mismatch: expected ${test.expectedIsCorrect}, got ${actualIsCorrect}. `;
                        }

                        if (test.expectedScore !== undefined && actualScore !== undefined) {
                            if (Math.abs(actualScore - test.expectedScore) > 0.001) {
                                status = "fail";
                                errorMsg += `Score mismatch: expected ${test.expectedScore}, got ${actualScore}. `;
                            }
                        }

                        return {
                            ...test,
                            actualScore,
                            actualIsCorrect,
                            status,
                            error: errorMsg.trim() || undefined,
                            responseBody: apiResponse,
                        };
                    } catch (err) {
                        return {
                            ...test,
                            status: "error" as const,
                            error: err instanceof Error ? err.message : String(err),
                        };
                    }
                })
            );
            result.behavioralTests = testResults;
        }
    }

    // Persist to DB (no-op if DATABASE_URL not set)
    if (body.batchId) {
        await saveResult(body.batchId, result);
    }

    return result;
}
