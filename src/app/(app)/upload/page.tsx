import { requireAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { getAccountKind, hasPatientRoster } from "@/lib/account-kind";
import { getRosterOrg, listRosterLinks } from "@/lib/patient-roster";
import { VaultUpload } from "@/components/upload/vault-upload";
import { RosterUpload, type RosterPatient } from "@/components/upload/roster-upload";
import { FileList } from "@/components/upload/file-list";

export const metadata = { title: "Upload — Ayus" };

function contactOf(p: { phone: string | null; email: string }): string | null {
  return p.phone ?? (p.email.endsWith("@phone.local") ? null : p.email);
}

export default async function UploadPage() {
  const userId = await requireAuth();
  const kind = await getAccountKind(userId);
  const roster = hasPatientRoster(kind);

  // ── Roster accounts (lab / doctor / hospital): upload FOR a consented
  //    patient. A roster account has no personal records of its own, so
  //    self-upload would be meaningless — pick a patient first. ────────────
  if (roster) {
    const org = await getRosterOrg(userId);
    const links = org ? await listRosterLinks(org.orgId) : [];
    const patients: RosterPatient[] = links
      .filter((l) => l.status === "GRANTED")
      .map((l) => ({
        id: l.patient.id,
        name: l.patient.name,
        contact: contactOf(l.patient),
      }));

    // Recent uploads across the org (any patient), so the roster sees its queue.
    const recentFiles = org
      ? await prisma.upload.findMany({
          where: { organizationId: org.orgId },
          orderBy: { createdAt: "desc" },
          take: 20,
          select: {
            id: true, originalName: true, mimeType: true, sizeBytes: true,
            status: true, uploadType: true, createdAt: true,
            report: { select: { id: true } },
            document: { select: { slug: true } },
          },
        })
      : [];

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
          <h1 className="font-heading text-3xl font-semibold tracking-tight">Upload for a Patient</h1>
          <p className="text-muted-foreground mt-1">
            Import a report for one of your consented patients. It lands in their
            records, attributed to your {kind === "doctor" ? "clinic" : kind === "hospital" ? "hospital" : "lab"}.
          </p>
        </div>

        <RosterUpload patients={patients} />

        <div>
          <h2 className="text-lg font-semibold mb-3">Recent Uploads</h2>
          <FileList files={serialized} />
        </div>
      </div>
    );
  }

  // ── Personal accounts: self-upload (unchanged) ───────────────────────────
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
