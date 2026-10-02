import { api, type MediaItem } from "./media";
import { v4 as uuidv4 } from "uuid";
import exifr from "exifr";
import { resolveContentType } from "./file-types";

export type UploadingItem = {
  id: string;
  file: File;
  previewUrl: string;
  progress: number;
  status: "uploading" | "done" | "error" | "cancelled";
  mime_type: string;
  abortController: AbortController;
};

type ExifData = {
  taken_at: string | null;
  width: number | null;
  height: number | null;
  camera_model: string | null;
  latitude: number | null;
  longitude: number | null;
};

export function createUploadingItem(file: File): UploadingItem {
  const mime = resolveContentType(file);
  return {
    id: uuidv4(),
    file,
    previewUrl: URL.createObjectURL(file),
    progress: 0,
    status: "uploading",
    mime_type: mime,
    abortController: new AbortController(),
  };
}

function extractVideoMeta(file: File): Promise<{ width: number | null; height: number | null }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      resolve({
        width: video.videoWidth || null,
        height: video.videoHeight || null,
      });
      URL.revokeObjectURL(url);
    };
    video.onerror = () => {
      resolve({ width: null, height: null });
      URL.revokeObjectURL(url);
    };
    video.src = url;
  });
}

type VideoPosterResult = {
  poster: Blob | null;
  duration: number | null;
};

function generateVideoPoster(file: File): Promise<VideoPosterResult> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;

    let duration: number | null = null;

    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.src = "";
    };

    video.onloadeddata = () => {
      if (video.duration && isFinite(video.duration)) {
        duration = video.duration;
      }
      video.currentTime = Math.min(1, video.duration / 2);
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) { cleanup(); resolve({ poster: null, duration }); return; }
        ctx.drawImage(video, 0, 0);
        canvas.toBlob(
          (blob) => { cleanup(); resolve({ poster: blob, duration }); },
          "image/jpeg",
          0.8
        );
      } catch {
        cleanup();
        resolve({ poster: null, duration });
      }
    };

    video.onerror = () => { cleanup(); resolve({ poster: null, duration: null }); };
    setTimeout(() => { cleanup(); resolve({ poster: null, duration }); }, 15000);
    video.src = url;
  });
}

async function uploadPoster(posterBlob: Blob, signal: AbortSignal): Promise<string | null> {
  try {
    const result = await multipartUpload(posterBlob, `${uuidv4()}.jpg`, "image/jpeg", () => {}, signal, true);
    return result.receipt;
  } catch { return null; }
}

async function extractExif(file: File, contentType: string): Promise<ExifData> {
  const result: ExifData = {
    taken_at: null,
    width: null,
    height: null,
    camera_model: null,
    latitude: null,
    longitude: null,
  };

  const isVideo = contentType.startsWith("video/");

  try {
    const exif = await exifr.parse(file, {
      pick: [
        "DateTimeOriginal",
        "CreateDate",
        "ImageWidth",
        "ImageHeight",
        "ExifImageWidth",
        "ExifImageHeight",
        "Model",
        "Make",
      ],
      gps: true,
    });

    if (exif) {
      const dateVal = exif.DateTimeOriginal || exif.CreateDate;
      if (dateVal instanceof Date) {
        result.taken_at = dateVal.toISOString();
      } else if (typeof dateVal === "string") {
        const parsed = new Date(dateVal);
        if (!isNaN(parsed.getTime())) result.taken_at = parsed.toISOString();
      }

      result.width = exif.ExifImageWidth || exif.ImageWidth || null;
      result.height = exif.ExifImageHeight || exif.ImageHeight || null;

      if (exif.Model) {
        result.camera_model = exif.Make
          ? `${exif.Make} ${exif.Model}`.replace(/\s+/g, " ").trim()
          : exif.Model;
      }

      if (typeof exif.latitude === "number" && typeof exif.longitude === "number") {
        result.latitude = exif.latitude;
        result.longitude = exif.longitude;
      }
    }
  } catch {
    // EXIF extraction is best-effort
  }

  if (isVideo && !result.width) {
    const videoMeta = await extractVideoMeta(file);
    result.width = videoMeta.width;
    result.height = videoMeta.height;
  }

  if (!result.taken_at && file.lastModified) {
    result.taken_at = new Date(file.lastModified).toISOString();
  }

  return result;
}

async function putPart(url: string, body: Blob, signal: AbortSignal, progress: (bytes: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    if (signal.aborted) { reject(new Error("Upload cancelled")); return; }
    signal.addEventListener("abort", abort, { once: true });
    const clean = () => signal.removeEventListener("abort", abort);
    xhr.open("PUT", url);
    xhr.upload.onprogress = event => progress(event.loaded);
    xhr.onload = () => {
      clean();
      const etag = xhr.getResponseHeader("ETag");
      if (xhr.status >= 200 && xhr.status < 300 && etag) resolve(etag);
      else reject(new Error(`Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => { clean(); reject(new Error("Upload connection failed")); };
    xhr.onabort = () => { clean(); reject(new Error("Upload cancelled")); };
    xhr.send(body);
  });
}

async function multipartUpload(file: Blob, name: string, type: string, onProgress: (pct: number) => void, signal: AbortSignal, poster = false, owner = ""): Promise<{ key: string; receipt: string }> {
  const fingerprint = `chama-upload:${owner}:${name}:${file.size}:${file instanceof File ? file.lastModified : 0}`;
  type State = { token: string; key: string; chunkSize: number; parts: { PartNumber: number; ETag: string }[]; expires: number };
  let state: State | null = null;
  if (!poster) {
    try { const previous = JSON.parse(localStorage.getItem(fingerprint) || "null"); if (previous?.expires > Date.now()) state = previous; } catch { /* storage unavailable */ }
  }
  if (!state) {
    const start = await api<{ token: string; key: string; chunkSize: number }>("/api/uploads", { operation: "initiate", name, type, size: file.size, poster }, "POST", signal);
    state = { ...start, parts: [], expires: Date.now() + 23 * 3600000 };
  }
  const save = () => { if (!poster) { try { localStorage.setItem(fingerprint, JSON.stringify(state)); } catch { /* optional resumability */ } } };
  save();
  try {
    const count = Math.ceil(file.size / state.chunkSize);
    for (let part = state.parts.length + 1; part <= count; part++) {
      const offset = (part - 1) * state.chunkSize;
      const body = file.slice(offset, Math.min(file.size, offset + state.chunkSize));
      let etag = "";
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const { url } = await api<{ url: string }>("/api/uploads", { operation: "part", token: state.token, part }, "POST", signal);
          etag = await putPart(url, body, signal, bytes => onProgress(Math.round((offset + bytes) / file.size * 100)));
          break;
        } catch (error) {
          if (signal.aborted || attempt === 2) throw error;
          await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 1000));
        }
      }
      state.parts.push({ PartNumber: part, ETag: etag });
      save();
    }
    const completed = await api<{ key: string; receipt: string }>("/api/uploads", { operation: "complete", token: state.token, parts: state.parts }, "POST", signal);
    try { localStorage.removeItem(fingerprint); } catch { /* optional */ }
    return completed;
  } catch (error) {
    if (signal.aborted) {
      await api("/api/uploads", { operation: "abort", token: state.token }).catch(() => {});
      try { localStorage.removeItem(fingerprint); } catch { /* optional */ }
    }
    throw error;
  }
}

export async function uploadFile(
  item: UploadingItem,
  uploaderName: string,
  onProgress: (progress: number) => void
): Promise<MediaItem | null> {
  const contentType = resolveContentType(item.file);

  if (item.abortController.signal.aborted) return null;

  onProgress(2);

  const exifData = await extractExif(item.file, contentType);

  if (item.abortController.signal.aborted) return null;

  try {
    const uploaded = await multipartUpload(
      item.file,
      item.file.name,
      contentType,
      (pct) => onProgress(Math.max(2, Math.min(95, pct))),
      item.abortController.signal,
      false,
      uploaderName
    );

    if (item.abortController.signal.aborted) return null;

    onProgress(97);

    let posterPath: string | null = null;
    let duration: number | null = null;
    if (contentType.startsWith("video/")) {
      const result = await generateVideoPoster(item.file);
      duration = result.duration;
      if (result.poster && !item.abortController.signal.aborted) {
        posterPath = await uploadPoster(result.poster, item.abortController.signal);
      }
    }

    onProgress(98);

    const inserted = await api<MediaItem>("/api/media", {
      receipt: uploaded.receipt,
      posterReceipt: posterPath,
      duration,
      ...exifData,
    }, "POST", item.abortController.signal);

    onProgress(100);
    // Return the persisted row so callers can insert it into local state
    // without refetching the whole table.
    return inserted as MediaItem;
  } catch (err) {
    console.error(`[upload] Failed: ${item.file.name} (type=${item.file.type}, resolved=${contentType}, size=${item.file.size})`, err);
    return null;
  }
}
