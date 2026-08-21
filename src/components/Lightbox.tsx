"use client";

import { useEffect, useCallback, useRef, useState } from "react";
import { MediaItem } from "@/lib/supabase";
import { supabase } from "@/lib/supabase";

type Props = {
  item: MediaItem;
  items: MediaItem[];
  currentUser: string | null;
  onClose: () => void;
  onNavigate: (item: MediaItem) => void;
  onDelete: (item: MediaItem) => void;
  onDownload: (item: MediaItem) => void;
};

function getPublicUrl(filePath: string) {
  return supabase.storage.from("media").getPublicUrl(filePath).data.publicUrl;
}

function getImageUrl(filePath: string) {
  return supabase.storage.from("media").getPublicUrl(filePath, {
    transform: { width: 2000, resize: "contain", quality: 90 },
  }).data.publicUrl;
}

function isVideo(mimeType: string) {
  return mimeType.startsWith("video/");
}

// Public Cloudflare Stream playback host (appears in viewer URLs, not secret).
const CF_STREAM_HOST = process.env.NEXT_PUBLIC_CLOUDFLARE_STREAM_CUSTOMER;

// Cloudflare's hosted adaptive-bitrate player. Handles HLS, buffering, and
// codec compatibility across browsers — replaces the manual buffering logic
// below for any video that has been transcoded into Stream.
function StreamPlayer({ uid, aspect }: { uid: string; aspect: number }) {
  return (
    <div
      style={{
        width: `min(90vw, ${(85 * aspect).toFixed(2)}vh)`,
        aspectRatio: `${aspect}`,
        maxHeight: "85vh",
      }}
    >
      <iframe
        src={`https://${CF_STREAM_HOST}/${uid}/iframe`}
        loading="lazy"
        allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
        allowFullScreen
        className="rounded-lg"
        style={{ border: 0, width: "100%", height: "100%" }}
      />
    </div>
  );
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const MIN_BUFFER_AHEAD = 10;
const LOW_BUFFER_THRESHOLD = 3;

function getBufferedAhead(video: HTMLVideoElement): number {
  const { buffered, currentTime } = video;
  for (let i = 0; i < buffered.length; i++) {
    if (buffered.start(i) <= currentTime + 0.5 && buffered.end(i) > currentTime) {
      return buffered.end(i) - currentTime;
    }
  }
  return 0;
}

function isBufferSufficient(video: HTMLVideoElement, minSeconds: number): boolean {
  const ahead = getBufferedAhead(video);
  const { duration } = video;
  if (duration && isFinite(duration) && duration <= minSeconds) {
    return ahead >= duration * 0.9;
  }
  return ahead >= minSeconds;
}

function LightboxVideo({ src }: { src: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [buffering, setBuffering] = useState(true);
  const startedRef = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    startedRef.current = false;
    setBuffering(true);

    const tryPlay = () => {
      if (!isBufferSufficient(video, MIN_BUFFER_AHEAD)) return;
      setBuffering(false);
      if (!startedRef.current) {
        startedRef.current = true;
        video.play().catch(() => {});
      }
    };

    const onProgress = () => tryPlay();
    const onCanPlayThrough = () => tryPlay();

    const onTimeUpdate = () => {
      if (getBufferedAhead(video) < LOW_BUFFER_THRESHOLD) {
        const { duration, currentTime } = video;
        const nearEnd = duration && isFinite(duration) && duration - currentTime < LOW_BUFFER_THRESHOLD;
        if (!nearEnd) {
          video.pause();
          setBuffering(true);
        }
      }
    };

    const onWaiting = () => {
      setBuffering(true);
    };

    const onPlaying = () => {
      setBuffering(false);
    };

    video.addEventListener("progress", onProgress);
    video.addEventListener("canplaythrough", onCanPlayThrough);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);
    return () => {
      video.removeEventListener("progress", onProgress);
      video.removeEventListener("canplaythrough", onCanPlayThrough);
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
    };
  }, [src]);

  return (
    <div className="relative">
      <video
        ref={videoRef}
        src={src}
        className="max-w-full max-h-[85vh] rounded-lg"
        controls
        preload="auto"
      />
      {buffering && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-12 h-12 border-3 border-white/30 border-t-white rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}

export default function Lightbox({ item, items, currentUser, onClose, onNavigate, onDelete, onDownload }: Props) {
  const currentIndex = items.findIndex((i) => i.id === item.id);

  const goNext = useCallback(() => {
    if (currentIndex < items.length - 1) {
      onNavigate(items[currentIndex + 1]);
    }
  }, [currentIndex, items, onNavigate]);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) {
      onNavigate(items[currentIndex - 1]);
    }
  }, [currentIndex, items, onNavigate]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") goNext();
      if (e.key === "ArrowLeft") goPrev();
    };
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [onClose, goNext, goPrev]);

  return (
    <div
      className="lightbox-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/95"
      onClick={onClose}
    >
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between p-4 z-10">
        <div className="text-white/80 text-sm flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium">{item.uploaded_by}</span>
          <span>&middot;</span>
          <span>{formatDate(item.taken_at || item.created_at)}</span>
          {item.camera_model && (
            <>
              <span>&middot;</span>
              <span className="text-white/50">{item.camera_model}</span>
            </>
          )}
          {item.width && item.height && (
            <>
              <span>&middot;</span>
              <span className="text-white/50">{item.width}&times;{item.height}</span>
            </>
          )}
          <span>&middot;</span>
          <span className="text-white/50">{formatFileSize(item.file_size)}</span>
        </div>
        <div className="flex items-center gap-3">
          {currentUser && currentUser === item.uploaded_by && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(item);
              }}
              className="text-white/60 hover:text-red-400 p-2 rounded-full hover:bg-white/10 transition-colors"
              title="Delete"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDownload(item);
            }}
            className="text-white/80 hover:text-white p-2 rounded-full hover:bg-white/10 transition-colors"
            title="Download"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="text-white/80 hover:text-white p-2 rounded-full hover:bg-white/10 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Navigation arrows */}
      {currentIndex > 0 && (
        <button
          className="absolute left-4 top-1/2 -translate-y-1/2 text-white/60 hover:text-white p-3 rounded-full hover:bg-white/10 transition-colors z-10"
          onClick={(e) => {
            e.stopPropagation();
            goPrev();
          }}
        >
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}
      {currentIndex < items.length - 1 && (
        <button
          className="absolute right-4 top-1/2 -translate-y-1/2 text-white/60 hover:text-white p-3 rounded-full hover:bg-white/10 transition-colors z-10"
          onClick={(e) => {
            e.stopPropagation();
            goNext();
          }}
        >
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}

      {/* Media content */}
      <div
        className="lightbox-content max-w-[90vw] max-h-[85vh] flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {isVideo(item.mime_type) ? (
          item.stream_uid && CF_STREAM_HOST ? (
            <StreamPlayer
              uid={item.stream_uid}
              aspect={(item.width || 16) / (item.height || 9)}
            />
          ) : (
            <LightboxVideo src={getPublicUrl(item.file_path)} />
          )
        ) : (
          <img
            src={getImageUrl(item.file_path)}
            alt={item.file_name}
            className="max-w-full max-h-[85vh] rounded-lg object-contain"
          />
        )}
      </div>

      {/* Counter */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/60 text-sm">
        {currentIndex + 1} of {items.length}
      </div>
    </div>
  );
}
