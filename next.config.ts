import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server build for Docker (small runtime image).
  output: "standalone",
  serverExternalPackages: [
    "pdf-parse",
    "pdfjs-dist",
    "@napi-rs/canvas",
    "@lancedb/lancedb",
    "chokidar",
  ],
};

export default nextConfig;
