"use client";

import { useState, useCallback, useRef } from "react";

type Props = {
  onFilesSelected: (files: File[]) => void;
  onClose?: () => void;
};

export default function UploadZone({ onFilesSelected, onClose }: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (fileList: FileList) => {
      const files = Array.from(fileList);
      if (files.length > 0) onFilesSelected(files);
    },
    [onFilesSelected]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  return (
    <div
      className={`drop-zone relative p-8 sm:p-12 text-center cursor-pointer ${isDragging ? "active" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => fileInputRef.current?.click()}
    >
      {onClose && (
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="absolute top-3 right-3 w-7 h-7 rounded-full flex items-center justify-center transition-colors"
          style={{ color: "var(--muted)", background: "var(--border)" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--foreground)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--muted)"; }}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,video/*,.heic,.heif,.mov"
        className="hidden"
        onChange={(e) => e.target.files && handleFiles(e.target.files)}
      />
      <div className="space-y-3">
        <svg
          className="w-12 h-12 mx-auto"
          style={{ color: "var(--muted)" }}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M12 16V4m0 0l-4 4m4-4l4 4M4 20h16"
          />
        </svg>
        <p className="text-lg font-medium">Drop photos & videos here</p>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          or click to browse — supports iPhone, Samsung, and GoPro formats
        </p>
      </div>
    </div>
  );
}
