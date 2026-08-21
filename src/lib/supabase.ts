import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _supabase: SupabaseClient | null = null;

export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    if (!_supabase) {
      _supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );
    }
    return (_supabase as unknown as Record<string, unknown>)[prop as string];
  },
});

export type MediaItem = {
  id: string;
  file_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  width: number | null;
  height: number | null;
  uploaded_by: string;
  taken_at: string | null;
  created_at: string;
  camera_model: string | null;
  latitude: number | null;
  longitude: number | null;
  poster_path: string | null;
  duration: number | null;
  stream_uid: string | null;
};
