"use client";

import { useState, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { v4 as uuidv4 } from "uuid";

type UploadProgress = {
  fileName: string;
  progress: number;
  status: "uploading" | "done" | "error";
};

type Props = {
  uploaderName: string;
  onUploadComplete: () => void;
};

export default function UploadZone({ uploaderName, onUploadComplete }: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploads, setUploads] = useState<UploadProgress[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    async (files: FileList) => {
      const fileArray = Array.from(files);
      if (fileArray.length === 0) return;

      setIsUploading(true);
      const progressMap: UploadProgress[] = fileArray.map((f) => ({
        fileName: f.name,
        progress: 0,
        status: "uploading",
      }));
      setUploads(progressMap);

      const uploadPromises = fileArray.map(async (file, index) => {
        const ext = file.name.split(".").pop() || "";
        const filePath = `${uuidv4()}.${ext}`;

        try {
          const { error: storageError } = await supabase.storage
            .from("media")
            .upload(filePath, file, {
              cacheControl: "3600",
              upsert: false,
            });

          if (storageError) throw storageError;

          const { error: dbError } = await supabase.from("media").insert({
            file_name: file.name,
            file_path: filePath,
            file_size: file.size,
            mime_type: file.type,
            uploaded_by: uploaderName,
          });

          if (dbError) throw dbError;

          setUploads((prev) =>
            prev.map((u, i) =>
              i === index ? { ...u, progress: 100, status: "done" } : u
            )
          );
        } catch {
          setUploads((prev) =>
            prev.map((u, i) =>
              i === index ? { ...u, status: "error" } : u
            )
          );
        }
      });

      await Promise.all(uploadPromises);
      setIsUploading(false);
      onUploadComplete();

      setTimeout(() => setUploads([]), 3000);
    },
    [uploaderName, onUploadComplete]
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

  const completedCount = uploads.filter((u) => u.status === "done").length;
  const totalCount = uploads.length;

  return (
    <div className="w-full">
      <div
        className={`drop-zone p-8 sm:p-12 text-center cursor-pointer ${isDragging ? "active" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,video/*"
          className="hidden"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />

        {!isUploading ? (
          <div className="space-y-3">
            <div className="text-4xl">
              <svg className="w-12 h-12 mx-auto" style={{ color: "var(--muted)" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 16V4m0 0l-4 4m4-4l4 4M4 20h16" />
              </svg>
            </div>
            <p className="text-lg font-medium">Drop photos & videos here</p>
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              or click to browse — supports iPhone, Samsung, and GoPro formats
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-lg font-medium">
              Uploading {completedCount} of {totalCount}...
            </p>
            <div className="progress-bar w-full max-w-xs mx-auto">
              <div
                className="progress-bar-fill"
                style={{ width: `${(completedCount / totalCount) * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {uploads.length > 0 && (
        <div className="mt-4 space-y-2 max-h-32 overflow-y-auto">
          {uploads.map((upload, i) => (
            <div
              key={i}
              className="flex items-center gap-3 text-sm px-3 py-2 rounded-lg"
              style={{ background: "var(--border)", opacity: upload.status === "done" ? 0.6 : 1 }}
            >
              <span className="truncate flex-1">{upload.fileName}</span>
              {upload.status === "done" && <span className="text-green-500">&#10003;</span>}
              {upload.status === "error" && <span className="text-red-500">Failed</span>}
              {upload.status === "uploading" && (
                <span className="animate-pulse" style={{ color: "var(--muted)" }}>...</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
