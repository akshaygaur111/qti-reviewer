import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import type { ReviewResult } from "@/lib/types";

export async function POST(req: NextRequest) {
    try {
        const { results } = (await req.json()) as { results: ReviewResult[] };
        if (!results || !Array.isArray(results)) {
            return NextResponse.json({ error: "Missing or invalid 'results' array." }, { status: 400 });
        }

        const workbook = new ExcelJS.Workbook();
        workbook.creator = "QTI Reviewer AI";
        workbook.lastModifiedBy = "QTI Reviewer AI";
        workbook.created = new Date();

        // 1. Summary Sheet
        const summarySheet = workbook.addWorksheet("Summary");
        summarySheet.columns = [
            { header: "Item ID", key: "id", width: 25 },
            { header: "Title", key: "title", width: 35 },
            { header: "Score", key: "score", width: 10 },
            { header: "Critical", key: "critical", width: 10 },
            { header: "Major", key: "major", width: 10 },
            { header: "Minor", key: "minor", width: 10 },
            { header: "Tests Status", key: "tests", width: 15 },
            { header: "Summary", key: "summary", width: 60 },
        ];

        results.forEach((r) => {
            const crit = r.issues.filter((i) => i.severity === "critical").length;
            const maj = r.issues.filter((i) => i.severity === "major").length;
            const min = r.issues.filter((i) => i.severity === "minor").length;

            const testsPass = r.behavioralTests?.filter(t => t.status === "pass").length || 0;
            const testsTotal = r.behavioralTests?.length || 0;
            const testStr = testsTotal > 0 ? `${testsPass}/${testsTotal} Pass` : "N/A";

            summarySheet.addRow({
                id: r.itemIdentifier || r.fileName,
                title: r.itemTitle || "Untitled",
                score: r.overallScore,
                critical: crit,
                major: maj,
                minor: min,
                tests: testStr,
                summary: r.overallSummary,
            });
        });

        // Formatting headers
        summarySheet.getRow(1).font = { bold: true };
        summarySheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0E0E0" } };

        // 2. Issues Detail Sheet
        const issueSheet = workbook.addWorksheet("Issues Detail");
        issueSheet.columns = [
            { header: "Item ID", key: "id", width: 20 },
            { header: "Category", key: "category", width: 20 },
            { header: "Severity", key: "severity", width: 15 },
            { header: "Issue Title", key: "message", width: 30 },
            { header: "Explanation", key: "detail", width: 50 },
            { header: "Recommendation", key: "rec", width: 50 },
        ];

        results.forEach((r) => {
            r.issues.forEach((issue) => {
                issueSheet.addRow({
                    id: r.itemIdentifier,
                    category: issue.category,
                    severity: issue.severity,
                    message: issue.message,
                    detail: issue.detail,
                    rec: issue.recommendation,
                });
            });
        });
        issueSheet.getRow(1).font = { bold: true };

        // 3. Behavioral Tests Sheet
        const testSheet = workbook.addWorksheet("Behavioral Tests");
        testSheet.columns = [
            { header: "Item ID", key: "id", width: 20 },
            { header: "Test Label", key: "label", width: 30 },
            { header: "Status", key: "status", width: 12 },
            { header: "Expected", key: "expected", width: 25 },
            { header: "Actual", key: "actual", width: 25 },
            { header: "Payload", key: "payload", width: 40 },
            { header: "Error/Detail", key: "error", width: 40 },
        ];

        results.forEach((r) => {
            r.behavioralTests?.forEach((test) => {
                const expectedStr = [
                    test.expectedIsCorrect !== undefined ? `Comp: ${test.expectedIsCorrect}` : "",
                    test.expectedScore !== undefined ? `Score: ${test.expectedScore}` : ""
                ].filter(Boolean).join(", ");

                const actualStr = [
                    test.actualIsCorrect !== undefined ? `Comp: ${test.actualIsCorrect}` : "",
                    test.actualScore !== undefined ? `Score: ${test.actualScore}` : ""
                ].filter(Boolean).join(", ");

                testSheet.addRow({
                    id: r.itemIdentifier,
                    label: test.label,
                    status: test.status.toUpperCase(),
                    expected: expectedStr,
                    actual: actualStr,
                    payload: JSON.stringify(test.payload),
                    error: test.error || "",
                });
            });
        });
        testSheet.getRow(1).font = { bold: true };

        const buffer = await workbook.xlsx.writeBuffer();

        return new NextResponse(buffer, {
            status: 200,
            headers: {
                "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "Content-Disposition": `attachment; filename="QTI_Review_Report_${Date.now()}.xlsx"`,
            },
        });
    } catch (err) {
        console.error("Excel export error:", err);
        return NextResponse.json({ error: "Failed to generate Excel report." }, { status: 500 });
    }
}
