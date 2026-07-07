"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { MediaItem } from "@/lib/supabase";
import { UploadingItem } from "@/lib/upload";
import { supabase } from "@/lib/supabase";

type Props = {
  items: MediaItem[];
  uploadingItems: UploadingItem[];
  currentUser: string | null;
  selectedIds: Set<string>;
  onItemClick: (item: MediaItem) => void;
  onCancelUpload: (id: string) => void;
  onDelete: (item: MediaItem) => void;
  onToggleSelect: (id: string) => void;
  onClearSelection: () => void;
  onDownload: (item: MediaItem) => void;
  onBatchDownload: () => void;
  onBatchDelete: () => void;
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

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function VideoDuration({ src }: { src: string }) {
  const [duration, setDuration] = useState<string | null>(null);

  useEffect(() => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.src = src;
    video.onloadedmetadata = () => {
      if (video.duration && isFinite(video.duration)) {
        setDuration(formatDuration(video.duration));
      }
    };
    return () => { video.src = ""; };
  }, [src]);

  if (!duration) return null;

  return (
    <div className="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded pointer-events-none">
      {duration}
    </div>
  );
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
  A: "#ef4444", B: "#f97316", C: "#eab308", D: "#22c55e",
  E: "#06b6d4", F: "#3b82f6", G: "#8b5cf6", H: "#ec4899",
  I: "#14b8a6", J: "#f59e0b", K: "#6366f1", L: "#84cc16",
  M: "#e11d48", N: "#0ea5e9", O: "#a855f7", P: "#f43f5e",
  R: "#10b981", S: "#7c3aed",
};

function getAvatarColor(name: string) {
  const letter = name.charAt(0).toUpperCase();
  return AVATAR_COLORS[letter] || "#6b7280";
}

type LayoutItem = { width: number; height: number };

function justifiedLayout(
  items: LayoutItem[],
  containerWidth: number,
  targetRowHeight: number,
  gap: number
): { width: number; height: number }[] {
  if (items.length === 0 || containerWidth <= 0) return [];

  const result: { width: number; height: number }[] = [];
  let row: { aspect: number; index: number }[] = [];
  let rowAspectSum = 0;

  for (let i = 0; i < items.length; i++) {
    const aspect = (items[i].width || 4) / (items[i].height || 3);
    row.push({ aspect, index: i });
    rowAspectSum += aspect;

    const rowWidth = rowAspectSum * targetRowHeight + (row.length - 1) * gap;

    if (rowWidth >= containerWidth || i === items.length - 1) {
      const usableWidth = containerWidth - (row.length - 1) * gap;
      let rowHeight: number;

      if (rowWidth >= containerWidth) {
        rowHeight = usableWidth / rowAspectSum;
      } else {
        rowHeight = Math.min(targetRowHeight, usableWidth / rowAspectSum);
      }

      for (const entry of row) {
        result[entry.index] = {
          width: entry.aspect * rowHeight,
          height: rowHeight,
        };
      }

      row = [];
      rowAspectSum = 0;
    }
  }

  return result;
}

function ProgressRing({ progress }: { progress: number }) {
  const radius = 24;
  const stroke = 3;
  const normalizedRadius = radius - stroke;
  const circumference = normalizedRadius * 2 * Math.PI;
  const strokeDashoffset = circumference - (progress / 100) * circumference;

  return (
    <div className="relative" style={{ width: radius * 2, height: radius * 2 }}>
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
      <span className="absolute inset-0 flex items-center justify-center text-white text-[10px] font-semibold tabular-nums">
        {progress}%
      </span>
    </div>
  );
}

type MenuState = {
  itemId: string;
  x: number;
  y: number;
} | null;

function ContextMenu({
  item,
  x,
  y,
  currentUser,
  onGetInfo,
  onDownload,
  onDelete,
  onClose,
}: {
  item: MediaItem;
  x: number;
  y: number;
  currentUser: string | null;
  onGetInfo: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });

  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    let adjustedX = x;
    let adjustedY = y;

    if (x + rect.width > window.innerWidth - 8) {
      adjustedX = x - rect.width;
    }
    if (y + rect.height > window.innerHeight - 8) {
      adjustedY = y - rect.height;
    }

    setPosition({ x: adjustedX, y: adjustedY });
  }, [x, y]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleScroll = () => onClose();
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("scroll", handleScroll, true);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("scroll", handleScroll, true);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  const isOwner = currentUser && currentUser === item.uploaded_by;

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: position.x, top: position.y }}
    >
      <button
        className="context-menu-item"
        onClick={(e) => { e.stopPropagation(); onGetInfo(); onClose(); }}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        Get Info
      </button>
      <button
        className="context-menu-item"
        onClick={(e) => { e.stopPropagation(); onDownload(); onClose(); }}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        Download
      </button>
      {isOwner && (
        <>
          <div className="context-menu-divider" />
          <button
            className="context-menu-item context-menu-item-danger"
            onClick={(e) => { e.stopPropagation(); onDelete(); onClose(); }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete
          </button>
        </>
      )}
    </div>
  );
}

function JustifiedGrid({
  items,
  currentUser,
  selectedIds,
  menuState,
  onItemClick,
  onDelete,
  onDownload,
  onToggleSelect,
  onMenuOpen,
  onMenuClose,
}: {
  items: MediaItem[];
  currentUser: string | null;
  selectedIds: Set<string>;
  menuState: MenuState;
  onItemClick: (item: MediaItem) => void;
  onDelete: (item: MediaItem) => void;
  onDownload: (item: MediaItem) => void;
  onToggleSelect: (id: string) => void;
  onMenuOpen: (itemId: string, x: number, y: number) => void;
  onMenuClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  const hasSelection = selectedIds.size > 0;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const gap = 4;
  const targetHeight = 220;

  const layoutItems: LayoutItem[] = items.map((item) => ({
    width: item.width || (isVideo(item.mime_type) ? 16 : 4),
    height: item.height || (isVideo(item.mime_type) ? 9 : 3),
  }));

  const sizes = containerWidth > 0
    ? justifiedLayout(layoutItems, containerWidth, targetHeight, gap)
    : [];

  return (
    <div ref={containerRef}>
      <div className="media-grid">
        {items.map((item, i) => {
          const size = sizes[i];
          if (!size) return null;
          const isSelected = selectedIds.has(item.id);
          const menuItem = menuState?.itemId === item.id ? items.find(it => it.id === menuState.itemId) : null;

          return (
            <div
              key={item.id}
              className={`media-grid-item relative group ${isSelected ? "ring-3 ring-blue-500 ring-inset" : ""}`}
              style={{
                width: `${size.width}px`,
                height: `${size.height}px`,
                flexGrow: 0,
                flexShrink: 0,
              }}
              onClick={() => {
                if (hasSelection) {
                  onToggleSelect(item.id);
                } else {
                  onItemClick(item);
                }
              }}
            >
              {isVideo(item.mime_type) ? (
                <>
                  <video
                    src={getPublicUrl(item.file_path)}
                    preload="metadata"
                    muted
                    onLoadedData={(e) => e.currentTarget.classList.add("loaded")}
                  />
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center">
                      <svg className="w-4 h-4 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </div>
                  </div>
                  <VideoDuration src={getPublicUrl(item.file_path)} />
                </>
              ) : (
                <img
                  src={getPublicUrl(item.file_path)}
                  alt={item.file_name}
                  loading="lazy"
                  onLoad={(e) => e.currentTarget.classList.add("loaded")}
                />
              )}

              {/* Checkbox — top-left, visible on hover or when any items are selected */}
              <button
                className={`absolute top-2 left-2 w-6 h-6 rounded flex items-center justify-center transition-all z-10 ${
                  isSelected
                    ? "bg-blue-500 text-white opacity-100"
                    : hasSelection
                    ? "bg-black/40 border border-white/50 opacity-100"
                    : "bg-black/40 border border-white/50 opacity-0 group-hover:opacity-100"
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleSelect(item.id);
                }}
              >
                {isSelected && (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>

              {/* Ellipsis menu — top-right, visible on hover */}
              {!hasSelection && (
                <button
                  className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/50 text-white/80 hover:bg-black/70 hover:text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all z-10"
                  onClick={(e) => {
                    e.stopPropagation();
                    const rect = e.currentTarget.getBoundingClientRect();
                    onMenuOpen(item.id, rect.right - 180, rect.bottom + 4);
                  }}
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <circle cx="5" cy="12" r="2" />
                    <circle cx="12" cy="12" r="2" />
                    <circle cx="19" cy="12" r="2" />
                  </svg>
                </button>
              )}

              {/* Uploader avatar — bottom-left on hover */}
              {!hasSelection && (
                <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="flex items-center gap-1.5">
                    <div
                      className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0"
                      style={{ background: getAvatarColor(item.uploaded_by) }}
                    >
                      {item.uploaded_by.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-white text-xs truncate">
                      {item.uploaded_by}
                    </span>
                  </div>
                </div>
              )}

              {/* Context menu */}
              {menuItem && menuState && (
                <ContextMenu
                  item={menuItem}
                  x={menuState.x}
                  y={menuState.y}
                  currentUser={currentUser}
                  onGetInfo={() => onItemClick(menuItem)}
                  onDownload={() => onDownload(menuItem)}
                  onDelete={() => onDelete(menuItem)}
                  onClose={onMenuClose}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function MediaGrid({
  items,
  uploadingItems,
  currentUser,
  selectedIds,
  onItemClick,
  onCancelUpload,
  onDelete,
  onToggleSelect,
  onClearSelection,
  onDownload,
  onBatchDownload,
  onBatchDelete,
}: Props) {
  const [menuState, setMenuState] = useState<MenuState>(null);

  const handleMenuOpen = useCallback((itemId: string, x: number, y: number) => {
    setMenuState({ itemId, x, y });
  }, []);

  const handleMenuClose = useCallback(() => {
    setMenuState(null);
  }, []);

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

  const hasSelection = selectedIds.size > 0;
  const selectedItems = items.filter((item) => selectedIds.has(item.id));
  const canBatchDelete = selectedItems.length > 0 && selectedItems.every(
    (item) => currentUser && currentUser === item.uploaded_by
  );

  const uploadingSection = activeUploads.length > 0 ? (
    <div className="mb-6">
      <h2
        className="text-sm font-semibold uppercase tracking-wider mb-3 sticky top-0 py-2 z-10"
        style={{ color: "var(--accent)", background: "var(--background)" }}
      >
        Uploading {activeUploads.length}{" "}
        {activeUploads.length === 1 ? "file" : "files"}...
      </h2>
      <div className="flex flex-wrap gap-1">
        {activeUploads.map((item) => (
          <div
            key={item.id}
            className="relative rounded overflow-hidden"
            style={{ width: 160, height: 120 }}
          >
            {isVideo(item.mime_type) ? (
              <video
                src={item.previewUrl}
                className="w-full h-full object-cover opacity-60"
                muted
                preload="metadata"
              />
            ) : (
              <img
                src={item.previewUrl}
                alt=""
                className="w-full h-full object-cover opacity-60"
              />
            )}
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40">
              {item.status === "uploading" && (
                <>
                  <ProgressRing progress={item.progress} />
                  <button
                    onClick={() => onCancelUpload(item.id)}
                    className="mt-1.5 text-white/80 hover:text-white text-xs font-medium px-2 py-0.5 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
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
        ))}
      </div>
    </div>
  ) : null;

  return (
    <div className="space-y-8">
      {uploadingSection}
      {groups.map(([date, groupItems]) => (
        <div key={date}>
          <h2
            className="text-sm font-semibold uppercase tracking-wider mb-3 sticky top-0 py-2 z-10"
            style={{ color: "var(--muted)", background: "var(--background)" }}
          >
            {date}
          </h2>
          <JustifiedGrid
            items={groupItems}
            currentUser={currentUser}
            selectedIds={selectedIds}
            menuState={menuState}
            onItemClick={onItemClick}
            onDelete={onDelete}
            onDownload={onDownload}
            onToggleSelect={onToggleSelect}
            onMenuOpen={handleMenuOpen}
            onMenuClose={handleMenuClose}
          />
        </div>
      ))}

      {/* Batch action bar */}
      {hasSelection && (
        <div className="batch-action-bar">
          <span className="text-sm font-medium">
            {selectedIds.size} {selectedIds.size === 1 ? "item" : "items"} selected
          </span>
          <div className="flex items-center gap-1">
            <button
              className="batch-action-btn"
              onClick={onBatchDownload}
              title="Download selected"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              <span className="hidden sm:inline text-xs">Download</span>
            </button>
            {canBatchDelete && (
              <button
                className="batch-action-btn batch-action-btn-danger"
                onClick={onBatchDelete}
                title="Delete selected"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                <span className="hidden sm:inline text-xs">Delete</span>
              </button>
            )}
            <button
              className="batch-action-btn"
              onClick={onClearSelection}
              title="Cancel selection"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              <span className="hidden sm:inline text-xs">Cancel</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
