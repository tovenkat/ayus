import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { storage } from "@/lib/storage";
import { requireApiAuth } from "@/lib/auth-helpers";
import { cascadeDeleteUpload } from "@/lib/delete-upload";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const authResult = await requireApiAuth();
  if (authResult.error) return authResult.error;
  const { userId } = authResult;

  const { id } = await params;

  const file = await prisma.upload.findUnique({ where: { id } });
  if (!file) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (file.userId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const buffer = await storage.download(file.storagePath);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, no-cache",
    },
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  const authResult = await requireApiAuth();
  if (authResult.error) return authResult.error;
  const { userId } = authResult;

  const { id } = await params;

  const file = await prisma.upload.findUnique({ where: { id } });
  if (!file) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (file.userId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await cascadeDeleteUpload(userId, id);

  // Bust the cached views that read the now-deleted derived data, so navigating
  // to them shows the update instead of a stale client-router-cached version.
  for (const p of ["/wiki", "/wiki/graph", "/dashboard", "/reports", "/upload"]) {
    revalidatePath(p);
  }

  return NextResponse.json({ ok: true });
}
