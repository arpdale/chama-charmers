import { supabase } from "./supabase";
import { v4 as uuidv4 } from "uuid";
import * as tus from "tus-js-client";
import exifr from "exifr";

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

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  "3gp": "video/3gpp",
};

function resolveContentType(file: File): string {
  if (file.type && file.type !== "application/octet-stream") {
    return file.type;
  }
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  return MIME_BY_EXT[ext] || "application/octet-stream";
}

export function isMediaFile(file: File): boolean {
  const type = resolveContentType(file);
  return type.startsWith("image/") || type.startsWith("video/");
}

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
  const posterPath = `posters/${uuidv4()}.jpg`;
  const { error } = await supabase.storage
    .from("media")
    .upload(posterPath, posterBlob, {
      contentType: "image/jpeg",
      cacheControl: "31536000",
    });
  if (error || signal.aborted) return null;
  return posterPath;
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

function tusUpload(
  file: File,
  filePath: string,
  contentType: string,
  onProgress: (pct: number) => void,
  signal: AbortSignal
): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  return new Promise((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: `${supabaseUrl}/storage/v1/upload/resumable`,
      retryDelays: [0, 1000, 3000, 5000],
      headers: {
        authorization: `Bearer ${supabaseKey}`,
        "x-upsert": "false",
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: "media",
        objectName: filePath,
        contentType,
        cacheControl: "3600",
      },
      chunkSize: file.size > 10 * 1024 * 1024 ? 6 * 1024 * 1024 : 1024 * 1024,
      onError(error) {
        const detail = (error as { originalResponse?: { getBody?: () => string } })
          .originalResponse?.getBody?.() || error.message;
        console.error(`[upload] TUS error for ${filePath}:`, detail);
        reject(error);
      },
      onProgress(bytesUploaded, bytesTotal) {
        const pct = Math.round((bytesUploaded / bytesTotal) * 100);
        onProgress(pct);
      },
      onSuccess() {
        resolve();
      },
    });

    signal.addEventListener("abort", () => {
      upload.abort(true);
      reject(new Error("Upload cancelled"));
    });

    upload.findPreviousUploads().then((previousUploads) => {
      if (previousUploads.length > 0) {
        upload.resumeFromPreviousUpload(previousUploads[0]);
      }
      upload.start();
    });
  });
}

export async function uploadFile(
  item: UploadingItem,
  uploaderName: string,
  onProgress: (progress: number) => void
): Promise<boolean> {
  const ext = item.file.name.split(".").pop()?.toLowerCase() || "";
  const filePath = `${uuidv4()}.${ext}`;
  const contentType = resolveContentType(item.file);

  if (item.abortController.signal.aborted) return false;

  onProgress(2);

  const exifData = await extractExif(item.file, contentType);

  if (item.abortController.signal.aborted) return false;

  try {
    await tusUpload(
      item.file,
      filePath,
      contentType,
      (pct) => onProgress(Math.max(2, Math.min(95, pct))),
      item.abortController.signal
    );

    if (item.abortController.signal.aborted) return false;

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

    const { error: dbError } = await supabase.from("media").insert({
      file_name: item.file.name,
      file_path: filePath,
      file_size: item.file.size,
      mime_type: contentType,
      uploaded_by: uploaderName,
      poster_path: posterPath,
      duration,
      ...exifData,
    });

    if (item.abortController.signal.aborted) return false;
    if (dbError) {
      console.error(`[upload] DB error for ${item.file.name}:`, dbError);
      throw dbError;
    }

    onProgress(100);
    return true;
  } catch (err) {
    console.error(`[upload] Failed: ${item.file.name} (type=${item.file.type}, resolved=${contentType}, size=${item.file.size})`, err);
    return false;
  }
}
