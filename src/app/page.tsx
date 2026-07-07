"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase, MediaItem } from "@/lib/supabase";
import { UploadingItem, createUploadingItem, uploadFile, isMediaFile } from "@/lib/upload";
import UploadZone from "@/components/UploadZone";
import MediaGrid from "@/components/MediaGrid";
import Lightbox from "@/components/Lightbox";
import NamePicker from "@/components/NamePicker";

export default function Home() {
  const [uploaderName, setUploaderName] = useState<string | null>(null);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [lightboxItem, setLightboxItem] = useState<MediaItem | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [showUpload, setShowUpload] = useState(false);
  const [uploadingItems, setUploadingItems] = useState<UploadingItem[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dragCounterRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchMedia = useCallback(async () => {
    const { data } = await supabase
      .from("media")
      .select("*")
      .order("created_at", { ascending: false });
    setMedia((data as MediaItem[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem("chama-uploader-name");
    if (stored) setUploaderName(stored);
    fetchMedia();
  }, [fetchMedia]);

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
        }).then((success) => {
          setUploadingItems((prev) =>
            prev.map((u) =>
              u.id === item.id
                ? { ...u, status: success ? "done" : "error", progress: success ? 100 : u.progress }
                : u
            )
          );
          if (success) {
            fetchMedia();
            setTimeout(() => {
              setUploadingItems((prev) => prev.filter((u) => u.id !== item.id));
              URL.revokeObjectURL(item.previewUrl);
            }, 2000);
          }
        });
      });
    },
    [uploaderName, fetchMedia]
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
      if (lightboxItem?.id === item.id) setLightboxItem(null);
    },
    [uploaderName, lightboxItem]
  );

  // Global drag-and-drop — intercept everywhere so files never open in browser tabs
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
      onDragEnter={handlePageDragEnter}
      onDragOver={handlePageDragOver}
      onDragLeave={handlePageDragLeave}
      onDrop={handlePageDrop}
    >
      {!uploaderName && <NamePicker onSelect={handleNameSelect} />}

      {/* Full-page drag overlay */}
      {isDraggingOver && (
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

      {/* Hidden file input for click-to-browse */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,video/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files) {
            handleFilesSelected(Array.from(e.target.files));
            e.target.value = "";
          }
        }}
      />

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
              {uploaderName && (
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

          {!isEmpty && (
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

      {/* Upload section (toggle) */}
      {showUpload && uploaderName && !isEmpty && (
        <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 pt-6">
          <UploadZone onFilesSelected={handleFilesSelected} />
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
          /* Empty state — centered drop zone */
          <div
            className="flex-1 flex items-center justify-center cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
          >
            <div
              className="drop-zone p-16 sm:p-20 text-center max-w-lg w-full"
            >
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
          <MediaGrid
            items={filteredMedia}
            uploadingItems={uploadingItems}
            currentUser={uploaderName}
            onItemClick={(item) => setLightboxItem(item)}
            onCancelUpload={handleCancelUpload}
            onDelete={handleDelete}
          />
        )}
      </main>

      {/* Lightbox */}
      {lightboxItem && (
        <Lightbox
          item={lightboxItem}
          items={filteredMedia}
          currentUser={uploaderName}
          onClose={() => setLightboxItem(null)}
          onNavigate={(item) => setLightboxItem(item)}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
