"use client";

import { useState } from "react";
import FileDropZone from "@/components/FileDropZone";
import ReviewCard from "@/components/ReviewCard";
import BulkSummaryBar from "@/components/BulkSummaryBar";
import ModelPicker from "@/components/ModelPicker";
import type { ReviewResult, BulkReviewResponse } from "@/lib/types";
// BulkReviewResponse used for download payload type

const DEFAULT_MODEL = "gemini-2.5-flash";

type Tab = "single" | "bulk";

// ---------------------------------------------------------------------------
// Single item tab
// ---------------------------------------------------------------------------

function SingleTab() {
  const [xml, setXml] = useState("");
  const [fileName, setFileName] = useState("item.xml");
  const [model, setModel] = useState(DEFAULT_MODEL);
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
        body: JSON.stringify({ xml, fileName, model }),
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
      <div className="flex flex-wrap items-center gap-3">
        <ModelPicker value={model} onChange={setModel} disabled={loading} />
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
// Bulk tab — client-side sequential processing (unlimited items)
// ---------------------------------------------------------------------------

interface BulkProgress {
  current: number;    // items completed
  total: number;
  currentFileName: string;
}

function buildBulkSummary(results: ReviewResult[]) {
  const succeeded = results.filter((r) => !r.error);
  return {
    total: results.length,
    succeeded: succeeded.length,
    failed: results.filter((r) => !!r.error).length,
    averageScore:
      succeeded.length > 0
        ? Math.round(
            (succeeded.reduce((s, r) => s + r.overallScore, 0) / succeeded.length) * 100
          ) / 100
        : 0,
    criticalIssueCount: succeeded.reduce(
      (count, r) => count + r.issues.filter((i) => i.severity === "critical").length,
      0
    ),
  };
}

function BulkTab() {
  const [items, setItems] = useState<{ name: string; content: string }[]>([]);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [running, setRunning] = useState(false);
  const [abortRef] = useState({ abort: false });
  const [progress, setProgress] = useState<BulkProgress | null>(null);
  const [results, setResults] = useState<ReviewResult[]>([]);
  const [expandAll, setExpandAll] = useState(false);

  function handleFiles(files: { name: string; content: string }[]) {
    setItems((prev) => {
      const existing = new Set(prev.map((f) => f.name));
      return [...prev, ...files.filter((f) => !existing.has(f.name))];
    });
  }

  function removeItem(name: string) {
    setItems((prev) => prev.filter((f) => f.name !== name));
  }

  async function handleStart() {
    if (items.length === 0) return;
    abortRef.abort = false;
    setRunning(true);
    setResults([]);
    setProgress({ current: 0, total: items.length, currentFileName: items[0].name });

    for (let i = 0; i < items.length; i++) {
      if (abortRef.abort) break;
      const item = items[i];
      setProgress({ current: i, total: items.length, currentFileName: item.name });

      let result: ReviewResult;
      try {
        const res = await fetch("/api/review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ xml: item.content, fileName: item.name, model }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Review failed");
        result = data as ReviewResult;
      } catch (err) {
        result = {
          itemIdentifier: "",
          itemTitle: item.name,
          fileName: item.name,
          overallScore: 0,
          overallSummary: "",
          issues: [],
          modelUsed: "",
          error: err instanceof Error ? err.message : String(err),
        };
      }

      // Append result live so user sees cards appear one by one
      setResults((prev) => [...prev, result]);
    }

    setProgress((p) => p ? { ...p, current: p.total } : null);
    setRunning(false);
  }

  function handleStop() {
    abortRef.abort = true;
    setRunning(false);
  }

  function handleDownload() {
    if (results.length === 0) return;
    const payload: BulkReviewResponse = { results, summary: buildBulkSummary(results) };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bulk-review-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const done = progress && progress.current === progress.total && !running;
  const pct = progress ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div className="space-y-6">
      <FileDropZone multiple onFiles={handleFiles} disabled={running} />

      {/* File list */}
      {items.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-gray-700">
              {items.length} file{items.length !== 1 ? "s" : ""} queued
            </p>
            <button
              onClick={() => { setItems([]); setResults([]); setProgress(null); }}
              className="text-xs text-gray-500 hover:text-red-600 transition-colors"
              disabled={running}
            >
              Clear all
            </button>
          </div>
          <ul className="space-y-1 max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-2 bg-white">
            {items.map((f) => {
              const done = results.some((r) => r.fileName === f.name);
              const failed = results.find((r) => r.fileName === f.name)?.error;
              return (
                <li key={f.name} className="flex items-center gap-2 text-sm text-gray-700 px-2 py-1 rounded hover:bg-gray-50">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${
                    failed ? "bg-red-400" : done ? "bg-green-400" :
                    running && progress?.currentFileName === f.name ? "bg-blue-400 animate-pulse" : "bg-gray-200"
                  }`} />
                  <span className="truncate flex-1">{f.name}</span>
                  {!running && (
                    <button onClick={() => removeItem(f.name)} className="text-gray-300 hover:text-red-500 transition-colors">✕</button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Progress bar */}
      {progress && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-gray-600">
            <span>
              {running
                ? `Reviewing: ${progress.currentFileName}`
                : `Done — ${progress.current} of ${progress.total} completed`}
            </span>
            <span className="font-medium">{pct}%</span>
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-2 bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        <ModelPicker value={model} onChange={setModel} disabled={running} />
        {!running ? (
          <button
            onClick={handleStart}
            disabled={items.length === 0}
            className="px-5 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {results.length > 0 ? "Restart Review" : `Review All (${items.length})`}
          </button>
        ) : (
          <button
            onClick={handleStop}
            className="px-5 py-2.5 bg-red-500 text-white rounded-lg font-medium hover:bg-red-600 transition-colors flex items-center gap-2"
          >
            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Stop
          </button>
        )}

        {results.length > 0 && !running && (
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

      {/* Live results */}
      {results.length > 0 && (
        <div className="space-y-6">
          {done && <BulkSummaryBar summary={buildBulkSummary(results)} />}

          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">
              Results ({results.length}{running ? "…" : ""})
            </h3>
            <button
              onClick={() => setExpandAll(!expandAll)}
              className="text-sm text-blue-600 hover:underline"
            >
              {expandAll ? "Collapse all" : "Expand all"}
            </button>
          </div>

          <div className="space-y-4">
            {results.map((r, i) => (
              <ReviewCard key={i} result={r} defaultExpanded={expandAll} />
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
          </button>
        </div>
        <div className="p-6">
          {tab === "single" ? <SingleTab /> : <BulkTab />}
        </div>
      </div>

    </div>
  );
}
