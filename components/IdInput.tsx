"use client";

import { useState } from "react";

interface Props {
  onAdd: (items: { name: string; itemId: string }[]) => void;
  disabled?: boolean;
}

export default function IdInput({ onAdd, disabled }: Props) {
  const [raw, setRaw] = useState("");

  function parseIds(text: string): string[] {
    return text
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const ids = parseIds(raw);

  function handleAdd() {
    if (ids.length === 0) return;
    onAdd(ids.map((id) => ({ name: id, itemId: id })));
    setRaw("");
  }

  return (
    <div className="border border-purple-200 rounded-xl p-4 bg-purple-50 space-y-3">
      <div className="flex items-center gap-2">
        <svg className="w-5 h-5 text-purple-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a2 2 0 012-2z" />
        </svg>
        <p className="text-sm font-semibold text-purple-900">Load by Item ID</p>
        <span className="ml-auto text-xs text-purple-500">alpha-1edtech API</span>
      </div>

      <p className="text-xs text-purple-700">
        Enter one or more assessment item IDs — one per line or comma-separated.
      </p>

      <textarea
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        placeholder={"item-001\nitem-002\nitem-003"}
        rows={3}
        disabled={disabled}
        className="w-full font-mono text-xs border border-purple-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white resize-y disabled:opacity-50"
      />

      <div className="flex items-center justify-between">
        {ids.length > 0 ? (
          <span className="text-xs text-purple-600">{ids.length} ID{ids.length !== 1 ? "s" : ""} ready</span>
        ) : (
          <span />
        )}
        <button
          onClick={handleAdd}
          disabled={ids.length === 0 || disabled}
          className="px-4 py-1.5 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50 transition-colors"
        >
          Add {ids.length > 0 ? ids.length : ""} to queue
        </button>
      </div>
    </div>
  );
}
