"use client";

import { useEffect, useState } from "react";

interface GeminiModel {
  name: string;        // "models/gemini-2.5-flash"
  displayName: string;
}

interface Props {
  value: string;
  onChange: (model: string) => void;
  disabled?: boolean;
}

export default function ModelPicker({ value, onChange, disabled }: Props) {
  const [models, setModels] = useState<GeminiModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setModels(data.models ?? []);
        // Auto-select first model if current value isn't in the list
        if (data.models?.length && !data.models.some((m: GeminiModel) => m.name.replace("models/", "") === value)) {
          onChange(data.models[0].name.replace("models/", ""));
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
        Loading models…
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-xs text-red-500" title={error}>
        Could not load models — using default
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <label className="text-sm font-medium text-gray-700 whitespace-nowrap">Model</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white disabled:opacity-50"
      >
        {models.map((m) => {
          const id = m.name.replace("models/", "");
          return (
            <option key={id} value={id}>
              {m.displayName || id}
            </option>
          );
        })}
      </select>
    </div>
  );
}
