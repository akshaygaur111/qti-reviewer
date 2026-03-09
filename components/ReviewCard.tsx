"use client";

import { useState } from "react";
import type { ReviewResult, Severity } from "@/lib/types";
import ScoreRing from "./ScoreRing";
import SeverityBadge from "./SeverityBadge";

const CATEGORY_LABELS: Record<string, string> = {
  content_accuracy: "Content Accuracy",
  scoring_logic: "Scoring Logic",
  response_processing: "Response Processing",
  answer_completeness: "Answer Completeness",
  qti_compliance: "QTI 3.0 Compliance",
  accessibility: "Accessibility",
};

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  major: 1,
  minor: 2,
  suggestion: 3,
};

interface Props {
  result: ReviewResult;
  defaultExpanded?: boolean;
}

export default function ReviewCard({ result, defaultExpanded = true }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const sortedIssues = [...result.issues].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
  );

  const criticalCount = result.issues.filter((i) => i.severity === "critical").length;
  const majorCount = result.issues.filter((i) => i.severity === "major").length;

  if (result.error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4">
        <div className="flex items-start gap-3">
          <span className="text-red-500 text-2xl">✗</span>
          <div>
            <p className="font-semibold text-red-800">{result.fileName}</p>
            <p className="text-sm text-red-600 mt-1">{result.error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-4 p-4 hover:bg-gray-50 transition-colors text-left"
      >
        <ScoreRing score={result.overallScore} size="sm" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 truncate">
            {result.itemTitle || result.itemIdentifier || result.fileName}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">{result.fileName}</p>
          <div className="flex gap-2 mt-1">
            {criticalCount > 0 && (
              <span className="text-xs text-red-600 font-medium">{criticalCount} critical</span>
            )}
            {majorCount > 0 && (
              <span className="text-xs text-orange-600 font-medium">{majorCount} major</span>
            )}
            {result.issues.length === 0 && (
              <span className="text-xs text-green-600 font-medium">No issues</span>
            )}
          </div>
        </div>
        <svg
          className={`w-5 h-5 text-gray-400 transition-transform shrink-0 ${expanded ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Body */}
      {expanded && (
        <div className="border-t border-gray-100">
          {result.overallSummary && (
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
              <p className="text-sm text-gray-700">{result.overallSummary}</p>
            </div>
          )}

          <div className="p-4 space-y-3">
            {sortedIssues.length === 0 ? (
              <p className="text-sm text-green-600 font-medium">✓ No issues found.</p>
            ) : (
              sortedIssues.map((issue, idx) => (
                <div key={idx} className="border border-gray-200 rounded-lg p-3 space-y-1.5">
                  <div className="flex items-start gap-2 flex-wrap">
                    <SeverityBadge severity={issue.severity} />
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                      {CATEGORY_LABELS[issue.category] ?? issue.category}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-gray-800">{issue.message}</p>
                  {issue.detail && (
                    <p className="text-xs text-gray-600">{issue.detail}</p>
                  )}
                  {issue.recommendation && (
                    <p className="text-xs text-blue-700 bg-blue-50 rounded px-2 py-1">
                      💡 {issue.recommendation}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>

          {result.behavioralTests && result.behavioralTests.length > 0 && (
            <div className="border-t border-gray-100 bg-white">
              <div className="px-4 py-2 bg-purple-50 flex items-center justify-between border-b border-purple-100">
                <span className="text-xs font-bold text-purple-700 uppercase tracking-wider flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Behavioral Verification
                </span>
                <span className="text-[10px] text-purple-500 font-medium">Alpha API scored</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50 text-gray-500 uppercase font-semibold">
                    <tr>
                      <th className="px-4 py-2 border-b">Test Case</th>
                      <th className="px-4 py-2 border-b">Expected</th>
                      <th className="px-4 py-2 border-b">Actual</th>
                      <th className="px-4 py-2 border-b text-right">Result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {result.behavioralTests.map((test, tidx) => (
                      <tr key={tidx} className="hover:bg-gray-50/50">
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-gray-900">{test.label}</div>
                          <div className="text-[10px] text-gray-400 font-mono mt-0.5 max-w-[200px] truncate">
                            {JSON.stringify(test.payload)}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-gray-600">
                          {test.expectedIsCorrect !== undefined && (
                            <div className="flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                              Correct: {test.expectedIsCorrect ? "Yes" : "No"}
                            </div>
                          )}
                          {test.expectedScore !== undefined && (
                            <div className="flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                              Score: {test.expectedScore}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-gray-600">
                          {test.actualIsCorrect !== undefined && (
                            <div className="flex items-center gap-1">
                              <span className={`w-1.5 h-1.5 rounded-full ${test.actualIsCorrect ? "bg-green-400" : "bg-red-400"}`} />
                              Correct: {test.actualIsCorrect ? "Yes" : "No"}
                            </div>
                          )}
                          {test.actualScore !== undefined && (
                            <div className="flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                              Score: {test.actualScore}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase transition-colors ${test.status === "pass" ? "bg-green-100 text-green-700" :
                              test.status === "fail" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700"
                            }`}>
                            {test.status}
                          </span>
                          {test.error && (
                            <div className="text-[9px] text-red-500 mt-1 max-w-[120px] ml-auto leading-tight italic">
                              {test.error}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="px-4 py-2 border-t border-gray-100 text-xs text-gray-400 text-right">
            Model: {result.modelUsed}
          </div>
        </div>
      )}
    </div>
  );
}
