import { supabase } from "./supabase";
import { v4 as uuidv4 } from "uuid";

export type UploadingItem = {
  id: string;
  file: File;
  previewUrl: string;
  progress: number;
  status: "uploading" | "done" | "error" | "cancelled";
  mime_type: string;
  abortController: AbortController;
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

export async function uploadFile(
  item: UploadingItem,
  uploaderName: string,
  onProgress: (progress: number) => void
): Promise<boolean> {
  const ext = item.file.name.split(".").pop() || "";
  const filePath = `${uuidv4()}.${ext}`;

  if (item.abortController.signal.aborted) return false;

  onProgress(10);

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
    });

    if (item.abortController.signal.aborted) return false;
    if (dbError) throw dbError;

    onProgress(100);
    return true;
  } catch {
    return false;
  }
}
