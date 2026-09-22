import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { lookupShareLink, recordShareView } from "@/lib/share";
import { EmergencyCardView, type EmergencyData } from "@/components/emergency/emergency-card-view";
import { SharePinChallenge } from "@/components/share/share-pin-challenge";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AiDisclaimer } from "@/components/ui/ai-disclaimer";
import { AlertTriangle, Clock, ShieldCheck } from "lucide-react";

export const metadata = { title: "Shared health record — Ayus" };

type Params = { params: Promise<{ token: string }> };

function ageFromDob(dob: Date | null): number | null {
  if (!dob) return null;
  return Math.floor((Date.now() - dob.getTime()) / (1000 * 60 * 60 * 24 * 365.25));
}

async function buildEmergencyData(userId: string): Promise<EmergencyData> {
  const [user, meds, critical] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true, email: true, phone: true, dateOfBirth: true, bloodType: true,
        allergies: true, chronicConditions: true,
        emergencyContactName: true, emergencyContactPhone: true, emergencyContactRelation: true,
      },
    }),
    prisma.medication.findMany({
      where: { userId, active: true },
      orderBy: { name: "asc" },
      select: { name: true, dosage: true, frequency: true, notes: true },
    }),
    prisma.testResult.findMany({
      where: { userId, isOutOfRange: true },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: { normalizedName: true, observedValueRaw: true, observedValueUnit: true, interpretation: true, createdAt: true },
    }),
  ]);

  const seen = new Set<string>();
  const unique = critical.filter((t) => {
    const k = t.normalizedName.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return {
    patient: {
      name: user?.name ?? user?.email ?? "Patient",
      dateOfBirth: user?.dateOfBirth ? user.dateOfBirth.toISOString().split("T")[0] : null,
      ageYears: ageFromDob(user?.dateOfBirth ?? null),
      bloodType: user?.bloodType ?? null,
      phone: user?.phone ?? null,
    },
    allergies: user?.allergies ?? [],
    chronicConditions: user?.chronicConditions ?? [],
    medications: meds.map((m) => ({ name: m.name, dosage: m.dosage, frequency: m.frequency, notes: m.notes })),
    emergencyContact: {
      name: user?.emergencyContactName ?? null,
      phone: user?.emergencyContactPhone ?? null,
      relation: user?.emergencyContactRelation ?? null,
    },
    criticalBiomarkers: unique.map((t) => ({
      name: t.normalizedName,
      value: t.observedValueRaw,
      unit: t.observedValueUnit,
      interpretation: t.interpretation,
      date: t.createdAt.toISOString().split("T")[0],
    })),
    generatedAt: new Date().toISOString(),
  };
}

function ShareBanner({ expiresAt }: { expiresAt?: Date }) {
  return (
    <div className="mx-auto max-w-3xl px-4 pt-4 print:hidden">
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="py-3 flex flex-wrap items-center gap-3 justify-between text-sm">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" />
            <span className="font-medium">Shared via Ayus</span>
            <Badge variant="outline" className="text-[10px]">Read-only</Badge>
          </div>
          {expiresAt && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="size-3.5" />
              Link expires {expiresAt.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ErrorState({ title, message }: { title: string; message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <Card className="max-w-md w-full">
        <CardContent className="py-10 text-center space-y-3">
          <div className="mx-auto size-12 rounded-full bg-destructive/10 text-destructive flex items-center justify-center">
            <AlertTriangle className="size-6" />
          </div>
          <h1 className="font-heading text-xl font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">{message}</p>
        </CardContent>
      </Card>
    </div>
  );
}

export default async function SharePage({ params }: Params) {
  const { token } = await params;
  const lookup = await lookupShareLink(token);

  if (!lookup.ok) {
    const messages = {
      not_found: { title: "Link not found", message: "This share link doesn't exist or has been removed." },
      expired: { title: "Link expired", message: "The person who shared this may create a new link for you." },
      revoked: { title: "Link revoked", message: "The patient has revoked access to this shared record." },
      view_limit: { title: "View limit reached", message: "This link has been viewed too many times." },
    };
    const m = messages[lookup.reason];
    return <ErrorState title={m.title} message={m.message} />;
  }

  const { link } = lookup;

  // PIN gate
  if (link.requiresPin) {
    const cookieStore = await cookies();
    const cookieName = `share_pin_${token}`;
    const verified = cookieStore.get(cookieName)?.value === "1";
    if (!verified) {
      return <SharePinChallenge token={token} />;
    }
  }

  await recordShareView(token);

  // Expiry metadata for banner
  const meta = await prisma.shareLink.findUnique({
    where: { token },
    select: { expiresAt: true },
  });

  if (link.resource === "EMERGENCY_CARD") {
    const data = await buildEmergencyData(link.userId);
    return (
      <div className="min-h-screen pb-8">
        <ShareBanner expiresAt={meta?.expiresAt} />
        <div className="px-4 pt-4">
          <EmergencyCardView data={data} />
        </div>
        <div className="mx-auto max-w-3xl px-4"><AiDisclaimer variant="footer" /></div>
      </div>
    );
  }

  if (link.resource === "VISIT_PREP") {
    const snapshot = link.snapshotJson as Record<string, unknown> | null;
    if (!snapshot) return <ErrorState title="Snapshot missing" message="This link was created without data. Ask for a fresh one." />;
    return (
      <div className="min-h-screen pb-8">
        <ShareBanner expiresAt={meta?.expiresAt} />
        <div className="max-w-3xl mx-auto px-4 pt-4 space-y-4">
          <h1 className="text-2xl font-semibold">Doctor Visit Prep</h1>
          <pre className="whitespace-pre-wrap rounded-md border bg-card p-4 text-sm">
            {JSON.stringify(snapshot, null, 2)}
          </pre>
          <p className="text-xs text-muted-foreground">
            Rich rendering for Visit Prep snapshots is coming soon.
          </p>
          <AiDisclaimer variant="footer" />
        </div>
      </div>
    );
  }

  if (link.resource === "DOCTOR_NOTE") {
    const snap = link.snapshotJson as {
      visitDate?: string;
      doctorName?: string;
      specialty?: string;
      clinic?: string | null;
      diagnosis?: string | null;
      notes?: string | null;
      followUpDate?: string | null;
      prescriptions?: Array<{
        medication: string;
        dosage?: string | null;
        frequency?: string | null;
        duration?: string | null;
        instructions?: string | null;
      }>;
    } | null;
    if (!snap) return <ErrorState title="Snapshot missing" message="This link was created without data. Ask for a fresh one." />;
    const visitDate = snap.visitDate ? new Date(snap.visitDate).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }) : null;
    const followUp = snap.followUpDate ? new Date(snap.followUpDate).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }) : null;
    return (
      <div className="min-h-screen pb-8">
        <ShareBanner expiresAt={meta?.expiresAt} />
        <div className="max-w-2xl mx-auto px-4 pt-4 space-y-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">Doctor visit</p>
            <h1 className="text-2xl font-heading font-semibold mt-1">{snap.doctorName ?? "Consultation"}</h1>
            <div className="flex items-center gap-2 flex-wrap mt-1 text-sm text-muted-foreground">
              {snap.specialty && <Badge variant="outline" className="text-[10px]">{snap.specialty}</Badge>}
              {visitDate && <span>{visitDate}</span>}
              {snap.clinic && <><span>·</span><span>{snap.clinic}</span></>}
            </div>
          </div>

          {snap.diagnosis && (
            <Card>
              <CardContent className="py-4 space-y-1">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Diagnosis</p>
                <p className="text-sm whitespace-pre-wrap">{snap.diagnosis}</p>
              </CardContent>
            </Card>
          )}

          {snap.notes && (
            <Card>
              <CardContent className="py-4 space-y-1">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Notes</p>
                <p className="text-sm whitespace-pre-wrap">{snap.notes}</p>
              </CardContent>
            </Card>
          )}

          {snap.prescriptions && snap.prescriptions.length > 0 && (
            <Card>
              <CardContent className="py-4 space-y-3">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Prescriptions</p>
                <ul className="space-y-2">
                  {snap.prescriptions.map((p, i) => (
                    <li key={i} className="border-l-2 border-primary/40 pl-3 py-1">
                      <p className="text-sm font-medium">{p.medication}</p>
                      <p className="text-xs text-muted-foreground">
                        {[p.dosage, p.frequency, p.duration].filter(Boolean).join(" · ") || "—"}
                      </p>
                      {p.instructions && <p className="text-xs text-muted-foreground italic mt-0.5">{p.instructions}</p>}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {followUp && (
            <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
              <CardContent className="py-3 flex items-center gap-2">
                <Clock className="size-4 text-amber-600" />
                <p className="text-sm">
                  <span className="font-medium">Follow-up:</span> {followUp}
                </p>
              </CardContent>
            </Card>
          )}
          <AiDisclaimer variant="footer" />
        </div>
      </div>
    );
  }

  return notFound();
}
