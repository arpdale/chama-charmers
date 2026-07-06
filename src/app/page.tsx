"use client";

import { useState, useEffect, useCallback } from "react";
import { supabase, MediaItem } from "@/lib/supabase";
import { UploadingItem, createUploadingItem, uploadFile } from "@/lib/upload";
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

  const uploaders = [...new Set(media.map((m) => m.uploaded_by))];
  const filteredMedia =
    filter === "all" ? media : media.filter((m) => m.uploaded_by === filter);

  return (
    <div className="flex flex-col min-h-screen">
      {!uploaderName && <NamePicker onSelect={handleNameSelect} />}

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
        </div>
      </header>

      {/* Upload section */}
      {showUpload && uploaderName && (
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
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6">
        {loading ? (
          <div className="media-grid">
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className="media-grid-item skeleton"
                style={{ height: `${150 + Math.random() * 150}px` }}
              />
            ))}
          </div>
        ) : (
          <MediaGrid
            items={filteredMedia}
            uploadingItems={uploadingItems}
            onItemClick={(item) => setLightboxItem(item)}
            onCancelUpload={handleCancelUpload}
          />
        )}
      </main>

      {/* Lightbox */}
      {lightboxItem && (
        <Lightbox
          item={lightboxItem}
          items={filteredMedia}
          onClose={() => setLightboxItem(null)}
          onNavigate={(item) => setLightboxItem(item)}
        />
      )}
    </div>
  );
}
