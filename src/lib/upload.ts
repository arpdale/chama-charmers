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

async function extractExif(file: File): Promise<ExifData> {
  const result: ExifData = {
    taken_at: null,
    width: null,
    height: null,
    camera_model: null,
    latitude: null,
    longitude: null,
  };

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

    if (!exif) return result;

    const dateVal = exif.DateTimeOriginal || exif.CreateDate;
    if (dateVal instanceof Date) {
      result.taken_at = dateVal.toISOString();
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
  } catch {
    // EXIF extraction is best-effort
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
      chunkSize: 6 * 1024 * 1024,
      onError(error) {
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

  const isImage = contentType.startsWith("image/");
  const exifData = isImage
    ? await extractExif(item.file)
    : { taken_at: null, width: null, height: null, camera_model: null, latitude: null, longitude: null };

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

    const { error: dbError } = await supabase.from("media").insert({
      file_name: item.file.name,
      file_path: filePath,
      file_size: item.file.size,
      mime_type: contentType,
      uploaded_by: uploaderName,
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
