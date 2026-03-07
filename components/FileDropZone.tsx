"use client";

import { useRef, useState, DragEvent, ChangeEvent } from "react";

interface Props {
  multiple?: boolean;
  onFiles: (files: { name: string; content: string }[]) => void;
  disabled?: boolean;
}

export default function FileDropZone({ multiple = false, onFiles, disabled }: Props) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function readFiles(fileList: FileList) {
    const results: { name: string; content: string }[] = [];
    for (const file of Array.from(fileList)) {
      if (!file.name.toLowerCase().endsWith(".xml")) continue;
      const content = await file.text();
      results.push({ name: file.name, content });
    }
    if (results.length > 0) onFiles(results);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    if (e.dataTransfer.files.length > 0) readFiles(e.dataTransfer.files);
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      readFiles(e.target.files);
      e.target.value = "";
    }
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => !disabled && inputRef.current?.click()}
      className={`
        flex flex-col items-center justify-center gap-3
        border-2 border-dashed rounded-xl p-8 cursor-pointer
        transition-colors select-none
        ${dragging ? "border-blue-400 bg-blue-50" : "border-gray-300 bg-gray-50 hover:border-blue-300 hover:bg-blue-50"}
        ${disabled ? "opacity-50 cursor-not-allowed" : ""}
      `}
    >
      <svg className="w-10 h-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
      </svg>
      <div className="text-center">
        <p className="text-sm font-medium text-gray-700">
          Drop QTI XML {multiple ? "files" : "file"} here
        </p>
        <p className="text-xs text-gray-500 mt-1">or click to browse — .xml files only</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".xml,text/xml,application/xml"
        multiple={multiple}
        onChange={handleChange}
        className="hidden"
        disabled={disabled}
      />
    </div>
  );
}
