import { supabase } from "./supabase";
import { v4 as uuidv4 } from "uuid";
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

export function createUploadingItem(file: File): UploadingItem {
  return {
    id: uuidv4(),
    file,
    previewUrl: URL.createObjectURL(file),
    progress: 0,
    status: "uploading",
    mime_type: file.type,
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

export async function uploadFile(
  item: UploadingItem,
  uploaderName: string,
  onProgress: (progress: number) => void
): Promise<boolean> {
  const ext = item.file.name.split(".").pop() || "";
  const filePath = `${uuidv4()}.${ext}`;

  if (item.abortController.signal.aborted) return false;

  onProgress(5);

  const isImage = item.file.type.startsWith("image/");
  const exifData = isImage ? await extractExif(item.file) : {
    taken_at: null, width: null, height: null,
    camera_model: null, latitude: null, longitude: null,
  };

  if (item.abortController.signal.aborted) return false;

  onProgress(15);

  try {
    const { error: storageError } = await supabase.storage
      .from("media")
      .upload(filePath, item.file, {
        cacheControl: "3600",
        upsert: false,
      });

    if (item.abortController.signal.aborted) return false;
    if (storageError) throw storageError;

    onProgress(80);

    const { error: dbError } = await supabase.from("media").insert({
      file_name: item.file.name,
      file_path: filePath,
      file_size: item.file.size,
      mime_type: item.file.type,
      uploaded_by: uploaderName,
      ...exifData,
    });

    if (item.abortController.signal.aborted) return false;
    if (dbError) throw dbError;

    onProgress(100);
    return true;
  } catch {
    return false;
  }
}
