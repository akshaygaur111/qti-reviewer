"use client";

import { useState } from "react";
import FileDropZone from "@/components/FileDropZone";
import ReviewCard from "@/components/ReviewCard";
import BulkSummaryBar from "@/components/BulkSummaryBar";
import ScoreRing from "@/components/ScoreRing";
import type { ReviewResult, BulkReviewResponse } from "@/lib/types";

type Tab = "single" | "bulk";

// ---------------------------------------------------------------------------
// Single item tab
// ---------------------------------------------------------------------------

function SingleTab() {
  const [xml, setXml] = useState("");
  const [fileName, setFileName] = useState("item.xml");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleFiles(files: { name: string; content: string }[]) {
    if (files[0]) {
      setXml(files[0].content);
      setFileName(files[0].name);
      setResult(null);
      setError(null);
    }
  }

  async function handleReview() {
    if (!xml.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ xml, fileName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Review failed");
      setResult(data as ReviewResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function handleDownload() {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `review-${result.itemIdentifier || "item"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      {/* Drop zone */}
      <FileDropZone onFiles={handleFiles} disabled={loading} />

      {/* XML textarea */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Or paste QTI XML directly
        </label>
        <textarea
          value={xml}
          onChange={(e) => { setXml(e.target.value); setResult(null); setError(null); }}
          placeholder='<?xml version="1.0" encoding="UTF-8"?>\n<assessmentItem xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" ...>'
          rows={8}
          disabled={loading}
          className="w-full font-mono text-xs border border-gray-300 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y disabled:opacity-50"
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleReview}
          disabled={!xml.trim() || loading}
          className="px-5 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          {loading ? (
            <>
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Reviewing…
            </>
          ) : (
            "Review Item"
          )}
        </button>

        {xml.trim() && !loading && (
          <button
            onClick={() => { setXml(""); setResult(null); setError(null); }}
            className="px-4 py-2.5 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors text-sm"
          >
            Clear
          </button>
        )}

        {result && (
          <button
            onClick={handleDownload}
            className="ml-auto px-4 py-2.5 border border-blue-300 text-blue-600 rounded-lg hover:bg-blue-50 transition-colors text-sm flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download JSON
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {result && <ReviewCard result={result} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bulk tab
// ---------------------------------------------------------------------------

function BulkTab() {
  const [items, setItems] = useState<{ name: string; content: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<BulkReviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandAll, setExpandAll] = useState(false);

  function handleFiles(files: { name: string; content: string }[]) {
    setItems((prev) => {
      const existing = new Set(prev.map((f) => f.name));
      const newFiles = files.filter((f) => !existing.has(f.name));
      return [...prev, ...newFiles];
    });
    setResponse(null);
    setError(null);
  }

  function removeItem(name: string) {
    setItems((prev) => prev.filter((f) => f.name !== name));
  }

  async function handleBulkReview() {
    if (items.length === 0) return;
    setLoading(true);
    setError(null);
    setResponse(null);
    try {
      const res = await fetch("/api/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: items.map((f) => ({ xml: f.content, fileName: f.name })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Bulk review failed");
      setResponse(data as BulkReviewResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function handleDownload() {
    if (!response) return;
    const blob = new Blob([JSON.stringify(response, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bulk-review-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <FileDropZone multiple onFiles={handleFiles} disabled={loading} />

      {/* File list */}
      {items.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-gray-700">
              {items.length} file{items.length !== 1 ? "s" : ""} queued
              {items.length > 20 && (
                <span className="text-orange-600 ml-2">(max 20 per batch)</span>
              )}
            </p>
            <button
              onClick={() => { setItems([]); setResponse(null); }}
              className="text-xs text-gray-500 hover:text-red-600 transition-colors"
              disabled={loading}
            >
              Clear all
            </button>
          </div>
          <ul className="space-y-1 max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-2 bg-white">
            {items.map((f) => (
              <li key={f.name} className="flex items-center gap-2 text-sm text-gray-700 px-2 py-1 rounded hover:bg-gray-50">
                <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span className="truncate flex-1">{f.name}</span>
                <button onClick={() => removeItem(f.name)} className="text-gray-300 hover:text-red-500 transition-colors" disabled={loading}>✕</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleBulkReview}
          disabled={items.length === 0 || loading || items.length > 20}
          className="px-5 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
        >
          {loading ? (
            <>
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Reviewing {items.length} item{items.length !== 1 ? "s" : ""}…
            </>
          ) : (
            `Review All (${items.length})`
          )}
        </button>

        {response && (
          <button
            onClick={handleDownload}
            className="ml-auto px-4 py-2.5 border border-blue-300 text-blue-600 rounded-lg hover:bg-blue-50 transition-colors text-sm flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download JSON
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {response && (
        <div className="space-y-6">
          <BulkSummaryBar summary={response.summary} />

          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">Item Results</h3>
            <button
              onClick={() => setExpandAll(!expandAll)}
              className="text-sm text-blue-600 hover:underline"
            >
              {expandAll ? "Collapse all" : "Expand all"}
            </button>
          </div>

          <div className="space-y-4">
            {response.results.map((r, i) => (
              <ReviewCard key={i} result={r} defaultExpanded={expandAll || response.results.length === 1} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function HomePage() {
  const [tab, setTab] = useState<Tab>("single");

  return (
    <div className="space-y-8">
      {/* Hero */}
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold text-gray-900">QTI 3.0 Item Reviewer</h1>
        <p className="text-gray-500 max-w-xl mx-auto">
          Upload or paste your QTI 3.0 XML assessment items for an AI-powered review covering
          content accuracy, scoring logic, response processing, answer completeness,
          QTI compliance, and accessibility.
        </p>
      </div>

      {/* Review criteria pills */}
      <div className="flex flex-wrap justify-center gap-2">
        {[
          "Content Accuracy",
          "Scoring Logic",
          "Response Processing",
          "Answer Completeness",
          "QTI 3.0 Compliance",
          "Accessibility",
        ].map((c) => (
          <span
            key={c}
            className="px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-medium border border-blue-200"
          >
            {c}
          </span>
        ))}
      </div>

      {/* Tab switcher */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setTab("single")}
            className={`flex-1 px-6 py-4 font-medium text-sm transition-colors ${
              tab === "single"
                ? "text-blue-600 border-b-2 border-blue-500 bg-blue-50"
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
            }`}
          >
            Single Item Review
          </button>
          <button
            onClick={() => setTab("bulk")}
            className={`flex-1 px-6 py-4 font-medium text-sm transition-colors ${
              tab === "bulk"
                ? "text-blue-600 border-b-2 border-blue-500 bg-blue-50"
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
            }`}
          >
            Bulk Review
            <span className="ml-1.5 text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full">
              up to 20 items
            </span>
          </button>
        </div>
        <div className="p-6">
          {tab === "single" ? <SingleTab /> : <BulkTab />}
        </div>
      </div>

      {/* Score legend */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Score Legend</p>
        <div className="grid grid-cols-5 gap-3">
          {[
            { range: "9–10", label: "Excellent", score: 10 },
            { range: "7–8", label: "Good", score: 8 },
            { range: "5–6", label: "Fair", score: 6 },
            { range: "3–4", label: "Poor", score: 4 },
            { range: "1–2", label: "Critical", score: 2 },
          ].map((s) => (
            <div key={s.label} className="flex flex-col items-center gap-1">
              <ScoreRing score={s.score} size="sm" />
              <span className="text-xs text-gray-500">{s.range}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
