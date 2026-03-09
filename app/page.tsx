"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import FileDropZone from "@/components/FileDropZone";
import ReviewCard from "@/components/ReviewCard";
import BulkSummaryBar from "@/components/BulkSummaryBar";
import SheetsInput from "@/components/SheetsInput";
import HistoryTab from "@/components/HistoryTab";
import type { ReviewResult, BulkReviewResponse } from "@/lib/types";

type Tab = "single" | "bulk" | "history";

// Queue item — either file-based (xml content) or URL-based (from sheet)
interface QueueItem {
  name: string;
  xml?: string;
  xmlUrl?: string;
}

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
      <FileDropZone onFiles={handleFiles} disabled={loading} />

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

      <div className="flex flex-wrap items-center gap-3">
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
          ) : "Review Item"}
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
        <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">{error}</div>
      )}

      {result && <ReviewCard result={result} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bulk tab — client-side sequential processing, DB persistence, Sheet import
// ---------------------------------------------------------------------------

interface BulkProgress {
  current: number;
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
        ? Math.round((succeeded.reduce((s, r) => s + r.overallScore, 0) / succeeded.length) * 100) / 100
        : 0,
    criticalIssueCount: succeeded.reduce(
      (count, r) => count + r.issues.filter((i) => i.severity === "critical").length, 0
    ),
  };
}

function BulkTab() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [running, setRunning] = useState(false);
  const [abortRef] = useState({ abort: false });
  const [progress, setProgress] = useState<BulkProgress | null>(null);
  const [results, setResults] = useState<ReviewResult[]>([]);
  const [expandAll, setExpandAll] = useState(false);
  const [savedBatchId, setSavedBatchId] = useState<string | null>(null);

  function handleFiles(files: { name: string; content: string }[]) {
    setItems((prev) => {
      const existing = new Set(prev.map((f) => f.name));
      return [...prev, ...files.filter((f) => !existing.has(f.name)).map((f) => ({ name: f.name, xml: f.content }))];
    });
  }

  function handleSheetItems(sheetItems: { name: string; xmlUrl: string }[]) {
    setItems((prev) => {
      const existing = new Set(prev.map((f) => f.name));
      return [...prev, ...sheetItems.filter((s) => !existing.has(s.name))];
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
    setSavedBatchId(null);
    setProgress({ current: 0, total: items.length, currentFileName: items[0].name });

    // Create a batch in DB (no-op if DB not configured)
    let batchId: string | null = null;
    try {
      const batchRes = await fetch("/api/history/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `Batch ${new Date().toLocaleString()} (${items.length} items)` }),
      });
      const batchData = await batchRes.json();
      batchId = batchData.batchId ?? null;
      if (batchId) setSavedBatchId(batchId);
    } catch { /* DB unavailable, continue without persistence */ }

    const collectedResults: ReviewResult[] = [];

    for (let i = 0; i < items.length; i++) {
      if (abortRef.abort) break;
      const item = items[i];
      setProgress({ current: i, total: items.length, currentFileName: item.name });

      let result: ReviewResult;
      try {
        const body: Record<string, string> = { fileName: item.name };
        if (item.xml) body.xml = item.xml;
        if (item.xmlUrl) body.xmlUrl = item.xmlUrl;
        if (batchId) body.batchId = batchId;

        const res = await fetch("/api/review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
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

      collectedResults.push(result);
      setResults([...collectedResults]);
    }

    // Update batch summary
    if (batchId && collectedResults.length > 0) {
      try {
        await fetch("/api/history/batches", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ batchId, summary: buildBulkSummary(collectedResults) }),
        });
      } catch { /* best-effort */ }
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
      {/* Input sources */}
      <FileDropZone multiple onFiles={handleFiles} disabled={running} />
      <SheetsInput onAdd={handleSheetItems} disabled={running} />

      {/* Queue */}
      {items.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-gray-700">
              {items.length} item{items.length !== 1 ? "s" : ""} queued
            </p>
            <button
              onClick={() => { setItems([]); setResults([]); setProgress(null); setSavedBatchId(null); }}
              className="text-xs text-gray-500 hover:text-red-600 transition-colors"
              disabled={running}
            >
              Clear all
            </button>
          </div>
          <ul className="space-y-1 max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-2 bg-white">
            {items.map((f) => {
              const resultForItem = results.find((r) => r.fileName === f.name);
              const isDone = !!resultForItem;
              const isFailed = !!resultForItem?.error;
              return (
                <li key={f.name} className="flex items-center gap-2 text-sm text-gray-700 px-2 py-1 rounded hover:bg-gray-50">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${
                    isFailed ? "bg-red-400" : isDone ? "bg-green-400" :
                    running && progress?.currentFileName === f.name ? "bg-blue-400 animate-pulse" : "bg-gray-200"
                  }`} />
                  <span className="truncate flex-1">{f.name}</span>
                  {f.xmlUrl && <span className="text-xs text-gray-400">URL</span>}
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
                : `Done — ${progress.current} of ${progress.total} completed${savedBatchId ? " · saved to history" : ""}`}
            </span>
            <span className="font-medium">{pct}%</span>
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-2 bg-blue-500 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
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
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("single");
  const [me, setMe] = useState<{ username: string; role: string } | null>(null);
  const [activeModel, setActiveModel] = useState<string>("");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => { if (u) setMe(u); })
      .catch(() => {});

    fetch("/api/admin/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => { if (s?.active_model) setActiveModel(s.active_model); })
      .catch(() => {});
  }, []);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "single", label: "Single Item" },
    { id: "bulk", label: "Bulk Review" },
    { id: "history", label: "History" },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <span className="font-semibold text-gray-900 text-sm">QTI Reviewer</span>
          {activeModel && (
            <span className="hidden sm:inline text-xs text-gray-400 border border-gray-200 rounded px-2 py-0.5">
              {activeModel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {me?.role === "admin" && (
            <button
              onClick={() => router.push("/admin")}
              className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-600"
            >
              Admin
            </button>
          )}
          {me && (
            <span className="text-xs text-gray-500 hidden sm:inline">
              {me.username}
            </span>
          )}
          <button
            onClick={handleLogout}
            className="text-xs px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        <div className="text-center space-y-1.5">
          <h1 className="text-3xl font-bold text-gray-900">QTI 3.0 Item Reviewer</h1>
          <p className="text-gray-500 max-w-xl mx-auto text-sm">
            AI-powered review of QTI 3.0 assessment items — scoring logic, compliance, content accuracy, and more.
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="flex border-b border-gray-200">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 px-6 py-4 font-medium text-sm transition-colors ${
                  tab === t.id
                    ? "text-blue-600 border-b-2 border-blue-500 bg-blue-50"
                    : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="p-6">
            {tab === "single" && <SingleTab />}
            {tab === "bulk" && <BulkTab />}
            {tab === "history" && <HistoryTab />}
          </div>
        </div>
      </div>
    </div>
  );
}
