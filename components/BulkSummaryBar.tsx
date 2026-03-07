import type { BulkReviewResponse } from "@/lib/types";

export default function BulkSummaryBar({ summary }: { summary: BulkReviewResponse["summary"] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
      <Stat label="Total" value={summary.total} color="text-gray-700" />
      <Stat label="Succeeded" value={summary.succeeded} color="text-green-600" />
      <Stat label="Failed" value={summary.failed} color={summary.failed > 0 ? "text-red-600" : "text-gray-400"} />
      <Stat label="Avg Score" value={`${summary.averageScore}/10`} color="text-blue-600" />
      <Stat label="Critical Issues" value={summary.criticalIssueCount} color={summary.criticalIssueCount > 0 ? "text-red-600" : "text-gray-400"} />
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 text-center shadow-sm">
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-gray-500 mt-1">{label}</p>
    </div>
  );
}
