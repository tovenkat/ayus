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
  // pdfjs-dist loads its worker + font/cmap assets via runtime-constructed
  // paths the file tracer can't see, so they get pruned from the standalone
  // build ("Cannot find module …/pdf.worker.mjs"). Force-include them. Keyed
  // to all routes since PDF parsing runs in the background extraction worker.
  outputFileTracingIncludes: {
    "/**": [
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./node_modules/pdfjs-dist/standard_fonts/**",
      "./node_modules/pdfjs-dist/cmaps/**",
    ],
  },
};

export default nextConfig;
