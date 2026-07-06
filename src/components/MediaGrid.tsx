"use client";

import { MediaItem } from "@/lib/supabase";
import { UploadingItem } from "@/lib/upload";
import { supabase } from "@/lib/supabase";

type Props = {
  items: MediaItem[];
  uploadingItems: UploadingItem[];
  currentUser: string | null;
  onItemClick: (item: MediaItem) => void;
  onCancelUpload: (id: string) => void;
  onDelete: (item: MediaItem) => void;
};

function getPublicUrl(filePath: string) {
  return supabase.storage.from("media").getPublicUrl(filePath).data.publicUrl;
}

function isVideo(mimeType: string) {
  return mimeType.startsWith("video/");
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function groupByDate(items: MediaItem[]) {
  const groups: { [key: string]: MediaItem[] } = {};

  items.forEach((item) => {
    const date = new Date(item.taken_at || item.created_at);
    const key = date.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  });

  return Object.entries(groups);
}

const AVATAR_COLORS: Record<string, string> = {
  A: "#ef4444",
  B: "#f97316",
  C: "#eab308",
  D: "#22c55e",
  E: "#06b6d4",
  F: "#3b82f6",
  G: "#8b5cf6",
  H: "#ec4899",
  I: "#14b8a6",
  J: "#f59e0b",
  K: "#6366f1",
  L: "#84cc16",
  M: "#e11d48",
  N: "#0ea5e9",
  O: "#a855f7",
  P: "#f43f5e",
  R: "#10b981",
  S: "#7c3aed",
};

function getAvatarColor(name: string) {
  const letter = name.charAt(0).toUpperCase();
  return AVATAR_COLORS[letter] || "#6b7280";
}

function ProgressRing({ progress }: { progress: number }) {
  const radius = 20;
  const stroke = 3;
  const normalizedRadius = radius - stroke;
  const circumference = normalizedRadius * 2 * Math.PI;
  const strokeDashoffset = circumference - (progress / 100) * circumference;

  return (
    <svg width={radius * 2} height={radius * 2} className="rotate-[-90deg]">
      <circle
        stroke="rgba(255,255,255,0.3)"
        fill="none"
        strokeWidth={stroke}
        r={normalizedRadius}
        cx={radius}
        cy={radius}
      />
      <circle
        stroke="white"
        fill="none"
        strokeWidth={stroke}
        strokeLinecap="round"
        r={normalizedRadius}
        cx={radius}
        cy={radius}
        style={{
          strokeDasharray: `${circumference} ${circumference}`,
          strokeDashoffset,
          transition: "stroke-dashoffset 0.3s ease",
        }}
      />
    </svg>
  );
}

function UploadingCard({
  item,
  onCancel,
}: {
  item: UploadingItem;
  onCancel: () => void;
}) {
  return (
    <div className="media-grid-item relative">
      {isVideo(item.mime_type) ? (
        <video
          src={item.previewUrl}
          className="w-full h-auto block opacity-60"
          muted
          preload="metadata"
        />
      ) : (
        <img
          src={item.previewUrl}
          alt=""
          className="w-full h-auto block opacity-60"
        />
      )}

      <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40">
        {item.status === "uploading" && (
          <>
            <ProgressRing progress={item.progress} />
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCancel();
              }}
              className="mt-2 text-white/80 hover:text-white text-xs font-medium px-2 py-1 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
            >
              Cancel
            </button>
          </>
        )}
        {item.status === "error" && (
          <div className="text-red-400 text-sm font-medium">Failed</div>
        )}
        {item.status === "cancelled" && (
          <div className="text-white/60 text-sm font-medium">Cancelled</div>
        )}
        {item.status === "done" && (
          <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        )}
      </div>
    </div>
  );
}

export default function MediaGrid({
  items,
  uploadingItems,
  currentUser,
  onItemClick,
  onCancelUpload,
  onDelete,
}: Props) {
  if (items.length === 0 && uploadingItems.length === 0) {
    return (
      <div className="text-center py-24 space-y-4">
        <svg
          className="w-20 h-20 mx-auto"
          style={{ color: "var(--muted)", opacity: 0.3 }}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1}
            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
        <p className="text-xl font-medium" style={{ color: "var(--muted)" }}>
          No photos yet
        </p>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Upload photos and videos from your trip to get started
        </p>
      </div>
    );
  }

  const groups = groupByDate(items);
  const activeUploads = uploadingItems.filter(
    (u) => u.status === "uploading" || u.status === "error"
  );

  return (
    <div className="space-y-8">
      {/* Uploading items at top */}
      {activeUploads.length > 0 && (
        <div>
          <h2
            className="text-sm font-semibold uppercase tracking-wider mb-4 sticky top-0 py-2 z-10"
            style={{ color: "var(--accent)", background: "var(--background)" }}
          >
            Uploading {activeUploads.length}{" "}
            {activeUploads.length === 1 ? "file" : "files"}...
          </h2>
          <div className="media-grid">
            {activeUploads.map((item) => (
              <UploadingCard
                key={item.id}
                item={item}
                onCancel={() => onCancelUpload(item.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Existing media grouped by date */}
      {groups.map(([date, groupItems]) => (
        <div key={date}>
          <h2
            className="text-sm font-semibold uppercase tracking-wider mb-4 sticky top-0 py-2 z-10"
            style={{ color: "var(--muted)", background: "var(--background)" }}
          >
            {date}
          </h2>
          <div className="media-grid">
            {groupItems.map((item) => (
              <div
                key={item.id}
                className="media-grid-item relative group"
                onClick={() => onItemClick(item)}
              >
                {isVideo(item.mime_type) ? (
                  <div className="relative">
                    <video
                      src={getPublicUrl(item.file_path)}
                      className="w-full h-auto block"
                      preload="metadata"
                      muted
                    />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-12 h-12 rounded-full bg-black/60 flex items-center justify-center">
                        <svg
                          className="w-5 h-5 text-white ml-0.5"
                          fill="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </div>
                    </div>
                    <div className="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-2 py-0.5 rounded">
                      {formatFileSize(item.file_size)}
                    </div>
                  </div>
                ) : (
                  <img
                    src={getPublicUrl(item.file_path)}
                    alt={item.file_name}
                    className="w-full h-auto block"
                    loading="lazy"
                  />
                )}

                {/* Delete button — only for owner */}
                {currentUser && currentUser === item.uploaded_by && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(item);
                    }}
                    className="absolute top-2 right-2 p-1.5 rounded-full bg-black/50 text-white/70 hover:bg-red-600 hover:text-white opacity-0 group-hover:opacity-100 transition-all"
                    title="Delete"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}

                <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                      style={{ background: getAvatarColor(item.uploaded_by) }}
                    >
                      {item.uploaded_by.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-white text-xs truncate">
                      {item.uploaded_by}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
