import { Suspense } from "react";
import Gallery from "@/components/Gallery";
import { gallery } from "@/lib/server/db";

async function InitialGallery() {
  const media = await gallery();
  return <Gallery initialMedia={media.slice(0, 36)} initialCount={media.length} />;
}

export default function Home() {
  return <Suspense fallback={<div className="p-8 text-center" role="status">Loading photos…</div>}><InitialGallery /></Suspense>;
}
