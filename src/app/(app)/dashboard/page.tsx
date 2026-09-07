import { Suspense } from "react";
import { requireAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { buildDashboardData } from "@/lib/dashboard-queries";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { NameCaptureCard } from "@/components/dashboard/name-capture-card";
import { RiskThermometer } from "@/components/dashboard/risk-thermometer";
import { RecoveryPlan } from "@/components/dashboard/recovery-plan";
import { PatientAccessRequests } from "@/components/patients/access-requests-server";
import { LabDashboard } from "@/components/dashboard/lab-dashboard";
import { DoctorDashboard } from "@/components/dashboard/doctor-dashboard";
import { HospitalDashboard } from "@/components/dashboard/hospital-dashboard";
import { getAccountKind } from "@/lib/account-kind";
import { buildRiskSummary } from "@/lib/risk-assessment";
import { H1, Muted } from "@/components/ui/typography";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";
import {
  Stethoscope, Pill, UtensilsCrossed, Calendar,
  Upload, Clock, Sun, Sunset, Moon, CloudSun, ArrowRight, Heart,
} from "lucide-react";

export const metadata = { title: "Dashboard — Ayus" };

const TIME_ICONS: Record<string, typeof Sun> = {
  morning: Sun, afternoon: CloudSun, evening: Sunset, night: Moon,
};

const FREQ_LABELS: Record<string, string> = {
  ONCE_DAILY: "1x/day", TWICE_DAILY: "2x/day", THRICE_DAILY: "3x/day",
  FOUR_TIMES_DAILY: "4x/day", AS_NEEDED: "PRN", WEEKLY: "Weekly",
  ALTERNATE_DAYS: "Alt days",
};

const MEAL_LABELS: Record<string, string> = {
  BREAKFAST: "Breakfast", MORNING_SNACK: "AM Snack", LUNCH: "Lunch",
  AFTERNOON_SNACK: "PM Snack", DINNER: "Dinner", EVENING_SNACK: "Eve Snack",
};

// ─── Lab Results Hero Section (PHR-style) ───────────────────────────────────

async function LabResultsSection({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const userId = await requireAuth();
  const params = await searchParams;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true, phone: true },
  });

  const [data, riskSummary] = await Promise.all([
    buildDashboardData(userId, {
      range: params.range ?? "all",
      from: params.from,
      to: params.to,
      category: params.category,
      abnormalOnly: params.abnormalOnly === "true",
      worseningOnly: params.worseningOnly === "true",
    }),
    buildRiskSummary(userId),
  ]);

  // Fallback chain: real name → first word of email → "there"
  const rawName = user?.name?.trim();
  const hasRealName = !!rawName && rawName.toLowerCase() !== "undefined" && rawName.toLowerCase() !== "null";
  const displayName = hasRealName
    ? rawName
    : user?.email && !user.email.endsWith("@phone.local") && !user.email.endsWith("@userid.local")
      ? user.email.split("@")[0]
      : "there";

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <H1 className="text-3xl lg:text-4xl">Welcome, {displayName}</H1>
        <Muted>Your personal health records, powered by AI.</Muted>
      </div>
      {!hasRealName && <NameCaptureCard />}
      <div className="grid gap-4 lg:grid-cols-2">
        <RiskThermometer summary={riskSummary} />
        <RecoveryPlan summary={riskSummary} />
      </div>
      <DashboardShell initialData={data} />
    </div>
  );
}

// ─── Health Sections (Medications, Diet, Doctor Notes) ──────────────────────

async function HealthSections() {
  const userId = await requireAuth();

  const [activeMeds, todayDiet, recentNotes, upcomingFollowups] = await Promise.all([
    prisma.medication.findMany({
      where: { userId, active: true },
      orderBy: { name: "asc" },
    }),
    prisma.dietSchedule.findMany({
      where: { userId, active: true },
      orderBy: { time: "asc" },
    }),
    prisma.doctorNote.findMany({
      where: { userId },
      include: { prescriptions: true },
      orderBy: { visitDate: "desc" },
      take: 3,
    }),
    prisma.doctorNote.findMany({
      where: { userId, followUpDate: { gte: new Date() } },
      orderBy: { followUpDate: "asc" },
      take: 5,
    }),
  ]);

  const today = new Date().getDay();
  const todayMeals = todayDiet.filter(
    (d) => d.daysOfWeek.length === 0 || d.daysOfWeek.includes(today)
  );

  return (
    <div className="space-y-6">
      {/* Pending access requests from providers (patient-side consent inbox) */}
      <Suspense fallback={null}>
        <PatientAccessRequests />
      </Suspense>

      {/* Upcoming Follow-ups alert */}
      {upcomingFollowups.length > 0 && (
        <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
          <CardContent className="py-4">
            <div className="flex items-center gap-2 mb-2">
              <Calendar className="size-4 text-amber-600" />
              <span className="font-semibold text-sm text-amber-800 dark:text-amber-200">
                Upcoming Follow-ups
              </span>
            </div>
            <div className="space-y-1.5">
              {upcomingFollowups.map((note) => (
                <div key={note.id} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{note.doctorName}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {note.specialty.toLowerCase().replace(/_/g, " ")}
                    </Badge>
                  </div>
                  <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
                    {note.followUpDate!.toLocaleDateString("en-US", {
                      weekday: "short", month: "short", day: "numeric",
                    })}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Today's Medications */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Pill className="size-4 text-violet-500" />
              Today&apos;s Medications
            </CardTitle>
            <Link href="/medications" className="text-xs text-primary hover:underline flex items-center gap-1">
              Manage <ArrowRight className="size-3" />
            </Link>
          </CardHeader>
          <CardContent>
            {activeMeds.length > 0 ? (
              <div className="space-y-2.5">
                {activeMeds.map((med) => (
                  <div key={med.id} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{med.name}</span>
                      {med.dosage && (
                        <span className="text-muted-foreground">({med.dosage})</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className="text-[10px]">
                        {FREQ_LABELS[med.frequency]}
                      </Badge>
                      {med.timeSlots.map((slot) => {
                        const Icon = TIME_ICONS[slot] ?? Clock;
                        return <Icon key={slot} className="size-3.5 text-muted-foreground" />;
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyCard label="No active medications" href="/medications" action="Add medication" />
            )}
          </CardContent>
        </Card>

        {/* Today's Diet */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <UtensilsCrossed className="size-4 text-orange-500" />
              Today&apos;s Meals
            </CardTitle>
            <Link href="/diet" className="text-xs text-primary hover:underline flex items-center gap-1">
              Manage <ArrowRight className="size-3" />
            </Link>
          </CardHeader>
          <CardContent>
            {todayMeals.length > 0 ? (
              <div className="space-y-2.5">
                {todayMeals.map((meal) => (
                  <div key={meal.id} className="flex items-start justify-between text-sm">
                    <div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-[10px]">
                          {MEAL_LABELS[meal.mealType]}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{meal.time}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{meal.items}</p>
                    </div>
                    {meal.calories && (
                      <span className="text-xs text-muted-foreground shrink-0">{meal.calories} cal</span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyCard label="No meals scheduled today" href="/diet" action="Plan a meal" />
            )}
          </CardContent>
        </Card>

        {/* Recent Doctor Visits */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Stethoscope className="size-4 text-emerald-500" />
              Recent Doctor Visits
            </CardTitle>
            <Link href="/doctor-notes" className="text-xs text-primary hover:underline flex items-center gap-1">
              View all <ArrowRight className="size-3" />
            </Link>
          </CardHeader>
          <CardContent>
            {recentNotes.length > 0 ? (
              <div className="space-y-3">
                {recentNotes.map((note) => (
                  <div key={note.id} className="text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{note.doctorName}</span>
                      <span className="text-xs text-muted-foreground">
                        {note.visitDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                    </div>
                    {note.diagnosis && (
                      <p className="text-xs text-muted-foreground">{note.diagnosis}</p>
                    )}
                    {note.prescriptions.length > 0 && (
                      <div className="flex gap-1 mt-1">
                        {note.prescriptions.slice(0, 3).map((rx) => (
                          <Badge key={rx.id} variant="outline" className="text-[10px]">
                            <Pill className="size-2 mr-0.5" />
                            {rx.medication}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyCard label="No visits recorded" href="/doctor-notes/new" action="Record a visit" />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function EmptyCard({ label, href, action }: { label: string; href: string; action: string }) {
  return (
    <div className="text-center py-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <Link href={href} className="text-xs text-primary hover:underline mt-1 inline-block">{action}</Link>
    </div>
  );
}

// ─── Fallback ───────────────────────────────────────────────────────────────

function DashboardFallback() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-9 w-48" />
        <Skeleton className="mt-2 h-5 w-72" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

// ─── Kind-specific placeholder ─────────────────────────────────────────────
//
// Phase A: Lab / Doctor / Hospital dashboards aren't built yet. Show a
// placeholder above the personal dashboard for those kinds so users
// understand what their plan will get in Phases B–E, without hiding the
// personal-health data they can still use today.

async function PlanSpecificHero() {
  const { getAccountKind, ACCOUNT_KIND_LABEL } = await import("@/lib/account-kind");
  const { requireAuth } = await import("@/lib/auth-helpers");
  const userId = await requireAuth();
  const kind = await getAccountKind(userId);
  if (kind === "personal" || kind === "unknown") return null;

  const COMING: Record<"lab" | "doctor" | "hospital", { title: string; phase: string; features: string[] }> = {
    lab: {
      title: "Your Laboratory dashboard is coming",
      phase: "Phase B–C",
      features: ["Patient roster with search & upload-on-behalf-of", "Needs-review queue with quality scoring", "Volume & throughput analytics", "Referring-doctor tracking"],
    },
    doctor: {
      title: "Your Doctor dashboard is coming",
      phase: "Phase B, D",
      features: ["Patient roster + longitudinal timeline", "Consultation notes + prescriptions", "Rule-based decision support (uses the Rule + Disease tables)", "Referrals in/out"],
    },
    hospital: {
      title: "Your Hospital dashboard is coming",
      phase: "Phase B, D, E",
      features: ["Everything Doctor plan gets", "Departments · wards · beds · admissions", "Multi-doctor teams with roles", "Institutional analytics + optional SSO"],
    },
  };
  const info = COMING[kind];

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">{ACCOUNT_KIND_LABEL[kind]}</Badge>
          <Badge variant="outline" className="text-[10px]">{info.phase}</Badge>
        </div>
        <CardTitle>{info.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="text-sm space-y-1.5">
          {info.features.map((f) => (
            <li key={f} className="flex items-start gap-2">
              <ArrowRight className="size-3.5 text-primary mt-0.5 shrink-0" />
              <span>{f}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground pt-2 border-t">
          Meanwhile you can still use every personal-health feature below with your own records.
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const userId = await requireAuth();
  const kind = await getAccountKind(userId);

  // Roster orgs get purpose-built operational dashboards instead of the personal one.
  if (kind === "lab" || kind === "doctor" || kind === "hospital") {
    return (
      <div className="space-y-10">
        <Suspense fallback={<DashboardFallback />}>
          {kind === "lab" ? <LabDashboard /> : kind === "doctor" ? <DoctorDashboard /> : <HospitalDashboard />}
        </Suspense>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {/* Doctor / Hospital placeholder — invisible for personal accounts. */}
      <Suspense fallback={null}>
        <PlanSpecificHero />
      </Suspense>

      {/* Lab Results + Charts (PHR-style hero section) */}
      <Suspense fallback={<DashboardFallback />}>
        <LabResultsSection searchParams={searchParams} />
      </Suspense>

      {/* Health Management Sections */}
      <Suspense fallback={<Skeleton className="h-64 rounded-xl" />}>
        <HealthSections />
      </Suspense>
    </div>
  );
}
