"use client";

import { useEffect, useState } from "react";
import type { Batch, ReviewResult } from "@/lib/types";
import ReviewCard from "./ReviewCard";
import BulkSummaryBar from "./BulkSummaryBar";

interface BatchWithResults extends Batch {
  results?: ReviewResult[];
}

export default function HistoryTab() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbAvailable, setDbAvailable] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [batchResults, setBatchResults] = useState<Record<string, ReviewResult[]>>({});
  const [loadingBatch, setLoadingBatch] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/history/batches")
      .then((r) => r.json())
      .then((data) => {
        setDbAvailable(data.dbAvailable ?? true);
        setBatches(data.batches ?? []);
      })
      .catch(() => setDbAvailable(false))
      .finally(() => setLoading(false));
  }, []);

  async function toggleBatch(batchId: string) {
    if (expanded === batchId) { setExpanded(null); return; }
    setExpanded(batchId);
    if (batchResults[batchId]) return;
    setLoadingBatch(batchId);
    try {
      const res = await fetch(`/api/history/batches/${batchId}`);
      const data = await res.json();
      setBatchResults((prev) => ({ ...prev, [batchId]: data.results ?? [] }));
    } catch { /* ignore */ }
    finally { setLoadingBatch(null); }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium", timeStyle: "short",
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-500 gap-2">
        <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
        Loading history…
      </div>
    );
  }

  if (!dbAvailable) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 space-y-3">
        <p className="font-semibold text-amber-900">Database not connected</p>
        <p className="text-sm text-amber-800">
          To save and retrieve review history, add a <code className="bg-white px-1 rounded">MONGODB_URI</code> environment variable pointing to your MongoDB database.
        </p>
        <ol className="text-sm text-amber-800 list-decimal list-inside space-y-1">
          <li>Use your existing MongoDB cluster or create a free one at <a href="https://cloud.mongodb.com" target="_blank" rel="noopener noreferrer" className="underline">MongoDB Atlas</a></li>
          <li>Copy the connection string (include the database name, e.g. <code className="bg-white px-1 rounded">.../qti-reviewer?...</code>)</li>
          <li>Add <code className="bg-white px-1 rounded">MONGODB_URI</code> to your Vercel project environment variables</li>
          <li>Redeploy</li>
        </ol>
      </div>
    );
  }

  if (batches.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400 space-y-2">
        <p className="text-4xl">📋</p>
        <p className="font-medium">No review history yet</p>
        <p className="text-sm">Run a review and results will appear here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {batches.map((batch) => {
        const isExpanded = expanded === batch.id;
        const results = batchResults[batch.id];
        const summary = {
          total: batch.total,
          succeeded: batch.succeeded,
          failed: batch.failed,
          averageScore: Number(batch.avg_score),
          criticalIssueCount: batch.critical,
        };

        return (
          <div key={batch.id} className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <button
              onClick={() => toggleBatch(batch.id)}
              className="w-full flex items-center gap-4 px-4 py-3 hover:bg-gray-50 transition-colors text-left"
            >
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 truncate">{batch.name}</p>
                <p className="text-xs text-gray-500 mt-0.5">{formatDate(batch.created_at)}</p>
              </div>
              <div className="flex gap-4 text-xs text-gray-500 shrink-0">
                <span>{batch.total} items</span>
                <span className="text-blue-600 font-medium">{Number(batch.avg_score).toFixed(1)}/10</span>
                {batch.critical > 0 && (
                  <span className="text-red-600 font-medium">{batch.critical} critical</span>
                )}
              </div>
              <svg
                className={`w-4 h-4 text-gray-400 transition-transform shrink-0 ${isExpanded ? "rotate-180" : ""}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {isExpanded && (
              <div className="border-t border-gray-100 p-4 space-y-4">
                {batch.total > 0 && <BulkSummaryBar summary={summary} />}
                {loadingBatch === batch.id ? (
                  <p className="text-sm text-gray-500 text-center py-4">Loading results…</p>
                ) : results?.length ? (
                  <div className="space-y-3">
                    {results.map((r, i) => (
                      <ReviewCard key={i} result={r} defaultExpanded={false} />
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 text-center py-4">No results stored for this batch.</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
