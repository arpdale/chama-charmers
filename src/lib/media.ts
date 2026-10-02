export type MediaItem = {
  id: string; file_name: string; file_path: string; file_size: number; mime_type: string;
  width: number | null; height: number | null; uploaded_by: string;
  taken_at: string | null; created_at: string; camera_model: string | null;
  latitude: number | null; longitude: number | null; poster_path: string | null;
  duration: number | null; stream_uid: string | null;
};
export function mediaUrl(path: string, variant?: "thumb" | "view") {
  return `/api/files/${path.split("/").map(encodeURIComponent).join("/")}${variant ? `?variant=${variant}` : ""}`;
}
export async function api<T>(path: string, body?: unknown, method = "POST", signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, signal });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Request failed");
  return result as T;
}
