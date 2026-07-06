"use client";

import { MediaItem } from "@/lib/supabase";
import { supabase } from "@/lib/supabase";

type Props = {
  items: MediaItem[];
  onItemClick: (item: MediaItem) => void;
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
};

function getAvatarColor(name: string) {
  const letter = name.charAt(0).toUpperCase();
  return AVATAR_COLORS[letter] || "#6b7280";
}

export default function MediaGrid({ items, onItemClick }: Props) {
  if (items.length === 0) {
    return (
      <div className="text-center py-24 space-y-4">
        <div className="text-6xl opacity-30">
          <svg className="w-20 h-20 mx-auto" style={{ color: "var(--muted)" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
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

  return (
    <div className="space-y-8">
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
                        <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
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
