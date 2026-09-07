import { requireAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { VisitPrepView } from "@/components/visit-prep/visit-prep-view";

export const metadata = { title: "Doctor Visit Prep — Ayus" };

export default async function VisitPrepPage() {
  const userId = await requireAuth();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="print:hidden">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">Doctor Visit Prep</h1>
        <p className="text-sm text-muted-foreground">
          A one-page summary built from your lab history, medications, and recent visits.
          Print it before your next appointment.
        </p>
      </div>

      <VisitPrepView patientName={user?.name ?? user?.email ?? "Patient"} />
    </div>
  );
}
