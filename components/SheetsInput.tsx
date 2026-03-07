"use client";

import { useState } from "react";
import type { SheetItem } from "@/app/api/sheets/route";

interface Props {
  onAdd: (items: { name: string; xmlUrl: string }[]) => void;
  disabled?: boolean;
}

export default function SheetsInput({ onAdd, disabled }: Props) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<SheetItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleLoad() {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    setPreview(null);
    try {
      const res = await fetch("/api/sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load sheet");
      setPreview(data.items as SheetItem[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function handleAdd() {
    if (!preview) return;
    onAdd(preview);
    setPreview(null);
    setUrl("");
  }

  return (
    <div className="border border-blue-200 rounded-xl p-4 bg-blue-50 space-y-3">
      <div className="flex items-center gap-2">
        {/* Google Sheets icon */}
        <svg className="w-5 h-5 text-green-600 shrink-0" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zm-7 3h5v2h-5V6zm0 4h5v2h-5v-2zm0 4h5v2h-5v-2zM7 6h3v2H7V6zm0 4h3v2H7v-2zm0 4h3v2H7v-2z"/>
        </svg>
        <p className="text-sm font-semibold text-blue-900">Load from Google Sheet</p>
        <a
          href="https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms/copy"
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto text-xs text-blue-600 hover:underline"
        >
          Copy template ↗
        </a>
      </div>

      <p className="text-xs text-blue-700">
        Sheet must be publicly shared. Columns: <code className="bg-white px-1 rounded">name</code> (optional) and <code className="bg-white px-1 rounded">url</code> — each row is a URL to a raw QTI XML file.
      </p>

      <div className="flex gap-2">
        <input
          type="url"
          value={url}
          onChange={(e) => { setUrl(e.target.value); setPreview(null); setError(null); }}
          placeholder="https://docs.google.com/spreadsheets/d/..."
          disabled={disabled || loading}
          className="flex-1 text-sm border border-blue-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white disabled:opacity-50"
        />
        <button
          onClick={handleLoad}
          disabled={!url.trim() || loading || disabled}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
        >
          {loading ? (
            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          ) : "Load"}
        </button>
      </div>

      {error && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">{error}</p>
      )}

      {preview && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-blue-900">
              Found {preview.length} item{preview.length !== 1 ? "s" : ""}
            </p>
            <button
              onClick={handleAdd}
              disabled={disabled}
              className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              Add {preview.length} to queue
            </button>
          </div>
          <ul className="max-h-32 overflow-y-auto bg-white rounded-lg border border-blue-200 divide-y divide-gray-100">
            {preview.map((item, i) => (
              <li key={i} className="px-3 py-1.5 text-xs text-gray-700 truncate">
                <span className="font-medium text-gray-900">{item.name}</span>
                <span className="text-gray-400 ml-2 truncate">{item.xmlUrl}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
