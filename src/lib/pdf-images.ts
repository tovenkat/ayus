import path from "node:path";
import { createRequire } from "node:module";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const RENDER_SCALE = 2.0;
const require = createRequire(import.meta.url);
const pdfjsRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));
const STANDARD_FONT_DATA_URL = `file://${path.join(pdfjsRoot, "standard_fonts")}/`;
const CMAP_URL = `file://${path.join(pdfjsRoot, "cmaps")}/`;

export async function pdfToImages(buffer: Buffer): Promise<Buffer[]> {
  const data = new Uint8Array(buffer);
  const doc = await getDocument({
    data,
    disableFontFace: true,
    useSystemFonts: false,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
    cMapUrl: CMAP_URL,
    cMapPacked: true,
  }).promise;
  const pages: Buffer[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext("2d");
      await page.render({
        canvas: null as unknown as HTMLCanvasElement,
        canvasContext: ctx as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;
      pages.push(await canvas.encode("png"));
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  return pages;
}

export async function bufferToImageBase64s(buffer: Buffer, mimeType: string): Promise<string[]> {
  if (mimeType === "application/pdf") {
    const pages = await pdfToImages(buffer);
    return pages.map((p) => p.toString("base64"));
  }
  return [buffer.toString("base64")];
}
