import { requireAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { VaultUpload } from "@/components/upload/vault-upload";
import { FileList } from "@/components/upload/file-list";

export const metadata = { title: "Upload — Ayus" };

export default async function UploadPage() {
  const userId = await requireAuth();

  const recentFiles = await prisma.upload.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      originalName: true,
      mimeType: true,
      sizeBytes: true,
      status: true,
      uploadType: true,
      createdAt: true,
      report: { select: { id: true } },
      document: { select: { slug: true } },
    },
  });

  const serialized = recentFiles.map((f) => ({
    id: f.id,
    originalName: f.originalName,
    mimeType: f.mimeType,
    sizeBytes: f.sizeBytes,
    status: f.status,
    uploadType: f.uploadType,
    createdAt: f.createdAt.toISOString(),
    reportId: f.report?.id ?? null,
    documentSlug: f.document?.slug ?? null,
  }));

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">Upload Health Documents</h1>
        <p className="text-muted-foreground mt-1">
          Import lab reports, doctor notes, prescriptions, and health documents.
        </p>
      </div>

      <VaultUpload />

      <div>
        <h2 className="text-lg font-semibold mb-3">Recent Uploads</h2>
        <FileList files={serialized} />
      </div>
    </div>
  );
}
