import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  turbopack: { root: process.cwd() },
  serverExternalPackages: ["heic-convert", "sharp"],
};

export default nextConfig;
