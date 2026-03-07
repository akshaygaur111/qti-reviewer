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
  const [activeTab, setActiveTab] = useState<"overview" | "issues" | "strengths">("overview");

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
              <span className="text-xs text-red-600 font-medium">
                {criticalCount} critical
              </span>
            )}
            {majorCount > 0 && (
              <span className="text-xs text-orange-600 font-medium">
                {majorCount} major
              </span>
            )}
            {criticalCount === 0 && majorCount === 0 && result.issues.length === 0 && (
              <span className="text-xs text-green-600 font-medium">No issues</span>
            )}
          </div>
        </div>
        <svg
          className={`w-5 h-5 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Body */}
      {expanded && (
        <div className="border-t border-gray-100">
          {/* Summary */}
          <div className="p-4 bg-gray-50 border-b border-gray-100">
            <p className="text-sm text-gray-700">{result.overallSummary}</p>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-gray-100">
            {(["overview", "issues", "strengths"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab
                    ? "border-blue-500 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                {tab === "overview" && "Category Scores"}
                {tab === "issues" && `Issues (${result.issues.length})`}
                {tab === "strengths" && `Strengths (${result.strengths.length})`}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="p-4">
            {activeTab === "overview" && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {result.categoryScores.map((cs) => (
                  <div
                    key={cs.category}
                    className="flex flex-col items-center gap-2 p-3 bg-gray-50 rounded-lg"
                  >
                    <ScoreRing score={cs.score} size="sm" />
                    <p className="text-xs font-medium text-gray-700 text-center">
                      {CATEGORY_LABELS[cs.category] ?? cs.category}
                    </p>
                    <p className="text-xs text-gray-500 text-center leading-relaxed">
                      {cs.summary}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {activeTab === "issues" && (
              <div className="space-y-3">
                {sortedIssues.length === 0 ? (
                  <p className="text-sm text-green-600 font-medium">✓ No issues found.</p>
                ) : (
                  sortedIssues.map((issue, idx) => (
                    <div
                      key={idx}
                      className="border border-gray-200 rounded-lg p-3 space-y-1.5"
                    >
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
            )}

            {activeTab === "strengths" && (
              <ul className="space-y-2">
                {result.strengths.length === 0 ? (
                  <li className="text-sm text-gray-500">No strengths identified.</li>
                ) : (
                  result.strengths.map((s, idx) => (
                    <li key={idx} className="flex gap-2 text-sm text-gray-700">
                      <span className="text-green-500 mt-0.5">✓</span>
                      <span>{s}</span>
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2 border-t border-gray-100 text-xs text-gray-400 text-right">
            Model: {result.modelUsed}
          </div>
        </div>
      )}
    </div>
  );
}
