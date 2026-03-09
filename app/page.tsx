"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import FileDropZone from "@/components/FileDropZone";
import ReviewCard from "@/components/ReviewCard";
import BulkSummaryBar from "@/components/BulkSummaryBar";
import SheetsInput from "@/components/SheetsInput";
import IdInput from "@/components/IdInput";
import HistoryTab from "@/components/HistoryTab";
import type { ReviewResult, BulkReviewResponse } from "@/lib/types";

type Tab = "single" | "bulk" | "history";

// Queue item — file-based (xml), URL-based (xmlUrl), or alpha API ID (itemId)
interface QueueItem {
  name: string;
  xml?: string;
  xmlUrl?: string;
  itemId?: string;
}

// ---------------------------------------------------------------------------
// Single item tab
// ---------------------------------------------------------------------------

function SingleTab() {
  const [xml, setXml] = useState("");
  const [fileName, setFileName] = useState("item.xml");
  const [itemId, setItemId] = useState("");
  const [loading, setLoading] = useState(false);
  const [reviewStep, setReviewStep] = useState<"idle" | "fetching" | "analyzing" | "testing" | "done">("idle");
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleFiles(files: { name: string; content: string }[]) {
    if (files[0]) {
      setXml(files[0].content);
      setFileName(files[0].name);
      setItemId("");
      setResult(null);
      setError(null);
    }
  }

  async function handleReview() {
    const hasContent = xml.trim() || itemId.trim();
    if (!hasContent) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setReviewStep("fetching");

    try {
      const body = itemId.trim()
        ? { itemId: itemId.trim(), fileName: `item-${itemId.trim()}.xml` }
        : { xml, fileName };

      // We'll simulate the steps visually since the API call is monolithic for now.
      // In a real high-latency scenario, we might use Server Sent Events or WebSockets.
      // For now, we update step based on internal progress of the one-shot API.

      setReviewStep("analyzing");
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Review failed");

      if (data.behavioralTests?.length > 0) {
        setReviewStep("testing");
        // Brief artificial delay for visual feedback if it was too fast
        await new Promise(r => setTimeout(r, 800));
      }

      setResult(data as ReviewResult);
      setReviewStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setReviewStep("idle");
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

  async function handleExportExcel() {
    if (!result) return;
    try {
      const res = await fetch("/api/review/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          results: [result],
          filename: `review-${result.itemIdentifier || itemId || "item"}-${Date.now()}.xlsx`
        }),
      });
      if (!res.ok) throw new Error("Excel export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `review-${result.itemIdentifier || "item"}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert("Export failed: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  return (
    <div className="space-y-6">
      <FileDropZone onFiles={handleFiles} disabled={loading} />

      <div className="flex gap-2 items-center">
        <div className="flex-1">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Or enter item ID <span className="text-purple-500 font-normal text-xs">(alpha-1edtech API)</span>
          </label>
          <input
            type="text"
            value={itemId}
            onChange={(e) => { setItemId(e.target.value); setXml(""); setResult(null); setError(null); }}
            placeholder="e.g. item-001"
            disabled={loading}
            className="w-full text-sm border border-purple-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white disabled:opacity-50"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Or paste QTI XML directly
        </label>
        <textarea
          value={xml}
          onChange={(e) => { setXml(e.target.value); setItemId(""); setResult(null); setError(null); }}
          placeholder='<?xml version="1.0" encoding="UTF-8"?>\n<assessmentItem xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" ...>'
          rows={8}
          disabled={loading}
          className="w-full font-mono text-xs border border-gray-300 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y disabled:opacity-50"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={handleReview}
          disabled={(!xml.trim() && !itemId.trim()) || loading}
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

        {(xml.trim() || itemId.trim()) && !loading && (
          <button
            onClick={() => { setXml(""); setItemId(""); setResult(null); setError(null); }}
            className="px-4 py-2.5 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors text-sm"
          >
            Clear
          </button>
        )}

        {result && (
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={handleDownload}
              className="px-4 py-2.5 border border-blue-300 text-blue-600 rounded-lg hover:bg-blue-50 transition-colors text-sm flex items-center gap-1.5"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              JSON
            </button>
            <button
              onClick={handleExportExcel}
              className="px-4 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm flex items-center gap-1.5 shadow-sm"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Excel Report
            </button>
          </div>
        )}
      </div>

      {loading && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-6">
          <div className="flex flex-col items-center text-center space-y-4">
            <div className="relative">
              <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
              {reviewStep === "testing" && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-[10px] font-bold text-blue-600 animate-pulse">API</span>
                </div>
              )}
            </div>

            <div className="space-y-1">
              <h3 className="font-semibold text-blue-900">
                {reviewStep === "fetching" && "Fetching Item Source..."}
                {reviewStep === "analyzing" && "AI Analysis & QTI Check..."}
                {reviewStep === "testing" && "Running Behavioral Tests..."}
              </h3>
              <p className="text-xs text-blue-600/70 max-w-xs mx-auto">
                {reviewStep === "analyzing" && "Gemini is reviewing content accuracy and generating edge-case payloads."}
                {reviewStep === "testing" && "Submitting payloads to Alpha API to verify scoring logic and feedback behavior."}
              </p>
            </div>

            {/* Roadmap Track */}
            <div className="w-full max-w-sm flex items-center gap-2 pt-2">
              {[
                { s: "fetching", l: "Fetch" },
                { s: "analyzing", l: "AI Review" },
                { s: "testing", l: "Test" }
              ].map((step, i, arr) => {
                const steps = ["fetching", "analyzing", "testing", "done"];
                const currentIndex = steps.indexOf(reviewStep);
                const stepIndex = steps.indexOf(step.s);
                const isComplete = currentIndex > stepIndex;
                const isActive = currentIndex === stepIndex;

                return (
                  <div key={step.s} className="flex-1 flex items-center gap-2">
                    <div className="flex flex-col items-center gap-1.5 flex-1">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${isComplete ? "bg-green-500 text-white" : isActive ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-500"
                        }`}>
                        {isComplete ? "✓" : i + 1}
                      </div>
                      <span className={`text-[10px] font-medium ${isActive ? "text-blue-700" : "text-gray-400"}`}>{step.l}</span>
                    </div>
                    {i < arr.length - 1 && (
                      <div className={`h-[2px] flex-1 translate-y-[-8px] ${isComplete ? "bg-green-500" : "bg-gray-200"}`} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

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

  function handleSheetItems(sheetItems: { name: string; xmlUrl?: string; itemId?: string }[]) {
    setItems((prev) => {
      const existing = new Set(prev.map((f) => f.name));
      return [...prev, ...sheetItems.filter((s) => !existing.has(s.name))];
    });
  }

  function handleIdItems(idItems: { name: string; itemId: string }[]) {
    setItems((prev) => {
      const existing = new Set(prev.map((f) => f.name));
      return [...prev, ...idItems.filter((s) => !existing.has(s.name))];
    });
  }

  useEffect(() => {
    // 1. Check if there's an active job on mount
    async function checkActiveJobs() {
      try {
        const res = await fetch("/api/review/jobs");
        const { activeJobs } = await res.json();
        if (activeJobs && activeJobs.length > 0) {
          const latest = activeJobs[0]; // simplest: just resume the latest one
          const confirmResume = confirm(`An active bulk job is already running on the server: ${latest.progress.current}/${latest.progress.total} items. Would you like to resume viewing its progress?`);
          if (confirmResume) {
            setRunning(true);
            setSavedBatchId(latest.batch_id);
            pollJob(latest._id, latest.batch_id);
          }
        }
      } catch (err) {
        console.error("Failed to check active jobs:", err);
      }
    }
    checkActiveJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pollJob = async (jobId: string, batchId: string) => {
    try {
      const res = await fetch(`/api/review/jobs?id=${jobId}`);
      if (!res.ok) throw new Error("Job polling failed");
      const job = await res.json();

      setProgress(job.progress);

      if (job.status === "completed") {
        setRunning(false);
        // Fetch the final results from the batch endpoint
        const resultsRes = await fetch(`/api/history/batches/${batchId}`);
        const data = await resultsRes.json();
        setResults(data.results ?? []);
      } else if (job.status === "failed") {
        setRunning(false);
        alert("Job failed or was cancelled.");
      } else {
        setTimeout(() => pollJob(jobId, batchId), 2000);
      }
    } catch (err) {
      console.error("Polling error:", err);
      setTimeout(() => pollJob(jobId, batchId), 5000);
    }
  };

  function removeItem(name: string) {
    setItems((prev) => prev.filter((f) => f.name !== name));
  }

  async function handleStart() {
    if (items.length === 0) return;
    setRunning(true);
    setResults([]);
    setSavedBatchId(null);
    setProgress({ current: 0, total: items.length, currentFileName: "Initializing..." });

    try {
      // 1. Create Batch
      const batchRes = await fetch("/api/history/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `Batch ${new Date().toLocaleString()} (${items.length} items)` }),
      });
      const { batchId } = await batchRes.json();
      if (!batchId) throw new Error("Failed to create batch");
      setSavedBatchId(batchId);

      // 2. Start Server-Side Job
      const jobRes = await fetch("/api/review/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId, items: items.map(i => ({ xml: i.xml, xmlUrl: i.xmlUrl, itemId: i.itemId, fileName: i.name })) }),
      });
      const { jobId } = await jobRes.json();
      if (!jobId) throw new Error("Failed to start job");

      // 3. Poll for progress using the shared function
      pollJob(jobId, batchId);

    } catch (err) {
      setRunning(false);
      alert("Failed to start bulk review: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  async function handleStop() {
    if (!running) return;
    setRunning(false);
    // Best effort cancellation
    try {
      const activeJobRes = await fetch("/api/review/jobs");
      const { activeJobs } = await activeJobRes.json();
      const myJob = activeJobs.find((j: any) => j.batch_id === savedBatchId);
      if (myJob) {
        await fetch(`/api/review/jobs?id=${myJob._id}`, { method: "DELETE" });
      }
    } catch (err) {
      console.error("Failed to cancel job:", err);
    }
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

  async function handleExportExcel() {
    if (results.length === 0) return;
    try {
      const res = await fetch("/api/review/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          results,
          filename: `bulk-review-${Date.now()}.xlsx`
        }),
      });
      if (!res.ok) throw new Error("Excel export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `bulk-review-${Date.now()}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert("Export failed: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  const done = progress && progress.current === progress.total && !running;
  const pct = progress ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Input sources */}
      <FileDropZone multiple onFiles={handleFiles} disabled={running} />
      <SheetsInput onAdd={handleSheetItems} disabled={running} />
      <IdInput onAdd={handleIdItems} disabled={running} />

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
                  <span className={`w-2 h-2 rounded-full shrink-0 ${isFailed ? "bg-red-400" : isDone ? "bg-green-400" :
                    running && progress?.currentFileName === f.name ? "bg-blue-400 animate-pulse" : "bg-gray-200"
                    }`} />
                  <span className="truncate flex-1">{f.name}</span>
                  {f.xmlUrl && <span className="text-xs text-gray-400">URL</span>}
                  {f.itemId && <span className="text-xs text-purple-400">API</span>}
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
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={handleDownload}
              className="px-4 py-2.5 border border-blue-300 text-blue-600 rounded-lg hover:bg-blue-50 transition-colors text-sm flex items-center gap-1.5"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              JSON
            </button>
            <button
              onClick={handleExportExcel}
              className="px-4 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm flex items-center gap-1.5 shadow-sm"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Excel Report
            </button>
          </div>
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
      .catch(() => { });

    fetch("/api/admin/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => { if (s?.active_model) setActiveModel(s.active_model); })
      .catch(() => { });
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
                className={`flex-1 px-6 py-4 font-medium text-sm transition-colors ${tab === t.id
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
