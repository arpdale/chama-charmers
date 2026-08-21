"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { supabase, MediaItem } from "@/lib/supabase";
import { UploadingItem, createUploadingItem, uploadFile, isMediaFile } from "@/lib/upload";
import UploadZone from "@/components/UploadZone";
import MediaGrid from "@/components/MediaGrid";
import Lightbox from "@/components/Lightbox";
import NamePicker from "@/components/NamePicker";

const PAGE_SIZE = 100;

function getPublicUrl(filePath: string) {
  return supabase.storage.from("media").getPublicUrl(filePath).data.publicUrl;
}

// Chronological (oldest first), matching the grid's date grouping. Used for
// both paginated pages and locally-appended uploads so ordering stays stable.
function sortMedia(items: MediaItem[]) {
  return [...items].sort((a, b) => {
    const ta = new Date(a.taken_at || a.created_at).getTime();
    const tb = new Date(b.taken_at || b.created_at).getTime();
    return ta - tb;
  });
}

async function downloadBlob(url: string, fileName: string) {
  const res = await fetch(url);
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(blobUrl);
}

export default function Home() {
  return (
    <Suspense>
      <HomeContent />
    </Suspense>
  );
}

function HomeContent() {
  const searchParams = useSearchParams();
  const canUpload = searchParams.get("upload") === "chunky";

  const [uploaderName, setUploaderName] = useState<string | null>(null);
  const [pickerDismissed, setPickerDismissed] = useState(false);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [lightboxItem, setLightboxItem] = useState<MediaItem | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [showUpload, setShowUpload] = useState(false);
  const [uploadingItems, setUploadingItems] = useState<UploadingItem[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const dragCounterRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // How many rows we've pulled from the server, used as the pagination offset.
  // Kept separate from media.length so locally-appended uploads don't shift it.
  const loadedCountRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const isUploader = canUpload && !!uploaderName;
  const showPicker = canUpload && !uploaderName && !pickerDismissed;

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);

    const from = loadedCountRef.current;
    const { data, error } = await supabase
      .from("media")
      .select("*")
      .order("taken_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (!error && data) {
      const rows = data as MediaItem[];
      loadedCountRef.current += rows.length;
      setMedia((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        const fresh = rows.filter((r) => !seen.has(r.id));
        return fresh.length ? sortMedia([...prev, ...fresh]) : prev;
      });
      setHasMore(rows.length === PAGE_SIZE);
    }

    setLoading(false);
    setLoadingMore(false);
    loadingMoreRef.current = false;
  }, []);

  useEffect(() => {
    if (canUpload) {
      const stored = localStorage.getItem("chama-uploader-name");
      if (stored) setUploaderName(stored);
    }
    loadMore();
  }, [loadMore, canUpload]);

  // Infinite scroll: load the next page when the sentinel nears the viewport.
  // Depends on `loading` too so it re-attaches once the sentinel first mounts.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore();
      },
      { rootMargin: "600px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loading, loadMore]);

  const handleNameSelect = (name: string) => {
    setUploaderName(name);
    localStorage.setItem("chama-uploader-name", name);
  };

  const handleFilesSelected = useCallback(
    (files: File[]) => {
      if (!uploaderName) return;

      const newItems = files.map(createUploadingItem);
      setUploadingItems((prev) => [...newItems, ...prev]);
      setShowUpload(false);

      newItems.forEach((item) => {
        uploadFile(item, uploaderName, (progress) => {
          setUploadingItems((prev) =>
            prev.map((u) => (u.id === item.id ? { ...u, progress } : u))
          );
        }).then((inserted) => {
          const success = !!inserted;
          setUploadingItems((prev) =>
            prev.map((u) =>
              u.id === item.id
                ? { ...u, status: success ? "done" : "error", progress: success ? 100 : u.progress }
                : u
            )
          );
          if (inserted) {
            // Insert the new row locally instead of refetching the whole table.
            // Dedupe by id in case a later page also picks it up.
            setMedia((prev) =>
              prev.some((m) => m.id === inserted.id)
                ? prev
                : sortMedia([...prev, inserted])
            );
            setTimeout(() => {
              setUploadingItems((prev) => prev.filter((u) => u.id !== item.id));
              URL.revokeObjectURL(item.previewUrl);
            }, 2000);
          } else {
            setTimeout(() => {
              setUploadingItems((prev) => prev.filter((u) => u.id !== item.id));
              URL.revokeObjectURL(item.previewUrl);
            }, 5000);
          }
        });
      });
    },
    [uploaderName]
  );

  const handleCancelUpload = useCallback((id: string) => {
    setUploadingItems((prev) =>
      prev.map((u) => {
        if (u.id === id) {
          u.abortController.abort();
          return { ...u, status: "cancelled" as const };
        }
        return u;
      })
    );
    setTimeout(() => {
      setUploadingItems((prev) => {
        const item = prev.find((u) => u.id === id);
        if (item) URL.revokeObjectURL(item.previewUrl);
        return prev.filter((u) => u.id !== id);
      });
    }, 1500);
  }, []);

  const handleDelete = useCallback(
    async (item: MediaItem) => {
      if (!uploaderName || uploaderName !== item.uploaded_by) return;
      if (!window.confirm(`Delete "${item.file_name}"?`)) return;

      await supabase.storage.from("media").remove([item.file_path]);
      await supabase.from("media").delete().eq("id", item.id);

      setMedia((prev) => prev.filter((m) => m.id !== item.id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
      if (lightboxItem?.id === item.id) setLightboxItem(null);
    },
    [uploaderName, lightboxItem]
  );

  const handleDownloadItem = useCallback(async (item: MediaItem) => {
    const url = getPublicUrl(item.file_path);
    await downloadBlob(url, item.file_name);
  }, []);

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleBatchDownload = useCallback(async () => {
    const selected = media.filter((item) => selectedIds.has(item.id));
    for (const item of selected) {
      await downloadBlob(getPublicUrl(item.file_path), item.file_name);
    }
    setSelectedIds(new Set());
  }, [media, selectedIds]);

  const handleBatchDelete = useCallback(async () => {
    if (!uploaderName) return;
    const selected = media.filter(
      (item) => selectedIds.has(item.id) && item.uploaded_by === uploaderName
    );
    if (selected.length === 0) return;

    const msg = selected.length === 1
      ? `Delete "${selected[0].file_name}"?`
      : `Delete ${selected.length} items?`;
    if (!window.confirm(msg)) return;

    for (const item of selected) {
      await supabase.storage.from("media").remove([item.file_path]);
      await supabase.from("media").delete().eq("id", item.id);
    }

    const deletedIds = new Set(selected.map((item) => item.id));
    setMedia((prev) => prev.filter((m) => !deletedIds.has(m.id)));
    setSelectedIds(new Set());
    if (lightboxItem && deletedIds.has(lightboxItem.id)) {
      setLightboxItem(null);
    }
  }, [uploaderName, media, selectedIds, lightboxItem]);

  const handleBatchChangeUploader = useCallback(async (newName: string) => {
    const selected = media.filter((item) => selectedIds.has(item.id));
    if (selected.length === 0) return;

    const ids = selected.map((item) => item.id);
    const { error } = await supabase
      .from("media")
      .update({ uploaded_by: newName })
      .in("id", ids);

    if (error) {
      console.error("[batch] Failed to change uploader:", error);
      return;
    }

    setMedia((prev) =>
      prev.map((m) => (ids.includes(m.id) ? { ...m, uploaded_by: newName } : m))
    );
    setSelectedIds(new Set());
  }, [media, selectedIds]);

  // Global drag-and-drop
  const handlePageDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setIsDraggingOver(true);
    }
  }, []);

  const handlePageDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handlePageDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDraggingOver(false);
    }
  }, []);

  const handlePageDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsDraggingOver(false);

      const files = Array.from(e.dataTransfer.files).filter(isMediaFile);
      if (files.length > 0) {
        handleFilesSelected(files);
      }
    },
    [handleFilesSelected]
  );

  const uploaders = [...new Set(media.map((m) => m.uploaded_by))];
  const filteredMedia =
    filter === "all" ? media : media.filter((m) => m.uploaded_by === filter);

  const isEmpty = !loading && media.length === 0 && uploadingItems.length === 0;

  return (
    <div
      className="flex flex-col min-h-screen relative"
      onDragEnter={isUploader ? handlePageDragEnter : undefined}
      onDragOver={isUploader ? handlePageDragOver : undefined}
      onDragLeave={isUploader ? handlePageDragLeave : undefined}
      onDrop={isUploader ? handlePageDrop : undefined}
    >
      {showPicker && <NamePicker onSelect={handleNameSelect} onDismiss={() => setPickerDismissed(true)} />}

      {/* Full-page drag overlay */}
      {isUploader && isDraggingOver && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm pointer-events-none">
          <div
            className="rounded-2xl p-12 text-center"
            style={{ background: "var(--background)", boxShadow: "0 25px 50px rgba(0,0,0,0.3)" }}
          >
            <svg
              className="w-16 h-16 mx-auto mb-4"
              style={{ color: "var(--accent)" }}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 16V4m0 0l-4 4m4-4l4 4M4 20h16" />
            </svg>
            <p className="text-xl font-semibold">Drop to upload</p>
            <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
              Photos and videos
            </p>
          </div>
        </div>
      )}

      {/* Hidden file input */}
      {isUploader && <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,video/*,.heic,.heif,.mov"
        className="hidden"
        onChange={(e) => {
          if (e.target.files) {
            handleFilesSelected(Array.from(e.target.files));
            e.target.value = "";
          }
        }}
      />}

      {/* Header */}
      <header
        className="sticky top-0 z-40 backdrop-blur-md border-b"
        style={{
          background: "color-mix(in srgb, var(--background) 85%, transparent)",
          borderColor: "var(--border)",
        }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              Chama Charmers
            </h1>
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              {media.length} {media.length === 1 ? "memory" : "memories"}
              {isUploader && (
                <span>
                  {" "}
                  &middot; uploading as{" "}
                  <button
                    onClick={() => {
                      localStorage.removeItem("chama-uploader-name");
                      setUploaderName(null);
                    }}
                    className="font-medium underline decoration-dotted underline-offset-2"
                  >
                    {uploaderName}
                  </button>
                </span>
              )}
            </p>
          </div>

          {isUploader && !isEmpty && (
            <button
              onClick={() => setShowUpload(!showUpload)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium text-white transition-all hover:scale-105 active:scale-95"
              style={{ background: "var(--accent)" }}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span className="hidden sm:inline">Add Photos</span>
            </button>
          )}
        </div>
      </header>

      {/* Upload section */}
      {isUploader && showUpload && !isEmpty && (
        <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 pt-6">
          <UploadZone onFilesSelected={handleFilesSelected} onClose={() => setShowUpload(false)} />
        </div>
      )}

      {/* Filter bar */}
      {uploaders.length > 1 && (
        <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 pt-6">
          <div className="flex gap-2 overflow-x-auto pb-2">
            <button
              onClick={() => setFilter("all")}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all whitespace-nowrap ${
                filter === "all" ? "text-white" : ""
              }`}
              style={{
                background: filter === "all" ? "var(--accent)" : "var(--border)",
              }}
            >
              All
            </button>
            {uploaders.map((name) => (
              <button
                key={name}
                onClick={() => setFilter(name)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all whitespace-nowrap ${
                  filter === name ? "text-white" : ""
                }`}
                style={{
                  background: filter === name ? "var(--accent)" : "var(--border)",
                }}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Content */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6 flex flex-col">
        {loading ? (
          <div className="media-grid">
            {[200, 180, 220, 190, 210, 170, 230, 185, 205, 195, 215, 175].map((h, i) => (
              <div
                key={i}
                className="media-grid-item skeleton"
                style={{ height: `${h}px` }}
              />
            ))}
          </div>
        ) : isEmpty ? (
          isUploader ? (
            <div
              className="flex-1 flex items-center justify-center cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="drop-zone p-16 sm:p-20 text-center max-w-lg w-full">
                <svg
                  className="w-16 h-16 mx-auto mb-6"
                  style={{ color: "var(--muted)" }}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <p className="text-xl font-semibold mb-2">
                  Drop your trip photos here
                </p>
                <p style={{ color: "var(--muted)" }}>
                  or click to browse
                </p>
                <p className="text-xs mt-4" style={{ color: "var(--muted)" }}>
                  Supports iPhone, Samsung, and GoPro formats
                </p>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <p className="text-xl font-semibold mb-2" style={{ color: "var(--muted)" }}>
                  No photos yet
                </p>
                <p className="text-sm" style={{ color: "var(--muted)" }}>
                  Check back soon!
                </p>
              </div>
            </div>
          )
        ) : (
          <MediaGrid
            items={filteredMedia}
            uploadingItems={uploadingItems}
            currentUser={isUploader ? uploaderName : null}
            selectedIds={selectedIds}
            readOnly={!isUploader}
            onItemClick={(item) => setLightboxItem(item)}
            onCancelUpload={handleCancelUpload}
            onDelete={handleDelete}
            onToggleSelect={handleToggleSelect}
            onClearSelection={handleClearSelection}
            onDownload={handleDownloadItem}
            onBatchDownload={handleBatchDownload}
            onBatchDelete={handleBatchDelete}
            onBatchChangeUploader={handleBatchChangeUploader}
          />
        )}

        {/* Infinite-scroll sentinel + spinner */}
        {!loading && !isEmpty && hasMore && (
          <div ref={sentinelRef} className="flex justify-center py-8">
            {loadingMore && (
              <div className="w-6 h-6 border-2 border-current/30 border-t-current rounded-full animate-spin" style={{ color: "var(--muted)" }} />
            )}
          </div>
        )}
      </main>

      {/* Lightbox */}
      {lightboxItem && (
        <Lightbox
          item={lightboxItem}
          items={filteredMedia}
          currentUser={isUploader ? uploaderName : null}
          onClose={() => setLightboxItem(null)}
          onNavigate={(item) => setLightboxItem(item)}
          onDelete={handleDelete}
          onDownload={handleDownloadItem}
        />
      )}
    </div>
  );
}
