import { requireAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { loadAIConfig } from "@/lib/ai/config";
import { PRICING } from "@/lib/pricing";
import { AiSettingsForm } from "@/components/settings/ai-settings-form";
import { EmergencyForm } from "@/components/settings/emergency-form";
import { User, Brain, Database, HardDrive, CreditCard, Sparkles, Siren } from "lucide-react";
import { H1 } from "@/components/ui/typography";

export const metadata = { title: "Settings — Ayus" };

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string }>;
}) {
  const userId = await requireAuth();
  const { welcome } = await searchParams;
  const isWelcome = welcome === "1";

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      name: true,
      email: true,
      createdAt: true,
      aiProvider: true,
      aiModel: true,
      privacyMode: true,
      byokKeyEncrypted: true,
      vllmBaseUrl: true,
      llamaCppBaseUrl: true,
      dateOfBirth: true,
      bloodType: true,
      allergies: true,
      chronicConditions: true,
      emergencyContactName: true,
      emergencyContactPhone: true,
      emergencyContactRelation: true,
      orgMemberships: {
        take: 1,
        orderBy: { createdAt: "asc" },
        select: {
          role: true,
          organization: {
            select: {
              name: true,
              slug: true,
              type: true,
              subscription: {
                select: {
                  tier: true,
                  status: true,
                  reportsPerMonth: true,
                  reportsUsed: true,
                  periodEnd: true,
                  trialEndsAt: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const membership = user?.orgMemberships[0];
  const org = membership?.organization;
  const sub = org?.subscription;
  const tier = sub?.tier ?? "FREE";
  const tierDef = PRICING[tier];
  const quotaPct = sub && sub.reportsPerMonth > 0
    ? Math.min(100, Math.round((sub.reportsUsed / sub.reportsPerMonth) * 100))
    : 0;

  const [docCount, uploadCount, chunkCount, medCount, dietCount, noteCount] = await Promise.all([
    prisma.document.count({ where: { userId } }),
    prisma.upload.count({ where: { userId } }),
    prisma.chunk.count({ where: { document: { userId } } }),
    prisma.medication.count({ where: { userId } }),
    prisma.dietSchedule.count({ where: { userId } }),
    prisma.doctorNote.count({ where: { userId } }),
  ]);

  let aiConfig;
  try {
    aiConfig = loadAIConfig();
  } catch {
    aiConfig = null;
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <H1 className="text-3xl lg:text-4xl">Settings</H1>

      {isWelcome && tier !== "FREE" && (
        <div className="rounded-md border border-primary/30 bg-primary/5 p-4 flex items-start gap-3">
          <Sparkles className="size-5 text-primary shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-medium text-sm">You're on {tierDef.label}. One more step.</p>
            <p className="text-xs text-muted-foreground">
              Scroll to <b>AI Configuration</b> below, pick your provider, and paste your API key
              (or use the system default). Your next upload will use it automatically.
            </p>
          </div>
        </div>
      )}

      {/* Profile */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <User className="size-4" />
            Profile
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Name</span>
            <span>{user?.name ?? "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Email</span>
            <span>{user?.email}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Member since</span>
            <span>{user?.createdAt.toLocaleDateString("en-US", { year: "numeric", month: "long" })}</span>
          </div>
        </CardContent>
      </Card>

      {/* Subscription */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CreditCard className="size-4" />
            Subscription
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Plan</span>
            <Badge variant={tier === "FREE" ? "secondary" : "default"}>{tierDef.label}</Badge>
          </div>
          {org && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Organization</span>
              <span>{org.name} <span className="text-xs text-muted-foreground">({org.type.toLowerCase()})</span></span>
            </div>
          )}
          {sub && (
            <>
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Reports this period</span>
                  <span>{sub.reportsUsed} / {sub.reportsPerMonth}</span>
                </div>
                <Progress value={quotaPct} />
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Status: {sub.status.toLowerCase()}</span>
                {sub.trialEndsAt && sub.status === "TRIAL" && (
                  <span>Trial ends {new Date(sub.trialEndsAt).toLocaleDateString()}</span>
                )}
              </div>
            </>
          )}
          <div className="pt-2">
            <a href="/pricing" className="text-xs underline">See all plans →</a>
          </div>
        </CardContent>
      </Card>

      {/* AI Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Brain className="size-4" />
            AI Configuration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <AiSettingsForm
            initial={{
              aiProvider: user?.aiProvider ?? null,
              aiModel: user?.aiModel ?? null,
              privacyMode: user?.privacyMode ?? false,
              hasByokKey: !!user?.byokKeyEncrypted,
              vllmBaseUrl: user?.vllmBaseUrl ?? null,
              llamaCppBaseUrl: user?.llamaCppBaseUrl ?? null,
              tier,
            }}
          />
        </CardContent>
      </Card>

      {/* Emergency info */}
      <Card id="emergency-card" className="scroll-mt-20">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Siren className="size-4 text-destructive" />
            Emergency info
          </CardTitle>
        </CardHeader>
        <CardContent>
          <EmergencyForm
            initial={{
              dateOfBirth: user?.dateOfBirth ? user.dateOfBirth.toISOString().split("T")[0] : null,
              bloodType: user?.bloodType ?? null,
              allergies: user?.allergies ?? [],
              chronicConditions: user?.chronicConditions ?? [],
              emergencyContactName: user?.emergencyContactName ?? null,
              emergencyContactPhone: user?.emergencyContactPhone ?? null,
              emergencyContactRelation: user?.emergencyContactRelation ?? null,
            }}
          />
        </CardContent>
      </Card>

      {/* Data Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="size-4" />
            Your Data
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Documents</span>
              <p className="text-xl font-bold">{docCount}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Uploads</span>
              <p className="text-xl font-bold">{uploadCount}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Chunks</span>
              <p className="text-xl font-bold">{chunkCount}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Doctor Notes</span>
              <p className="text-xl font-bold">{noteCount}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Medications</span>
              <p className="text-xl font-bold">{medCount}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Diet Plans</span>
              <p className="text-xl font-bold">{dietCount}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Storage */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <HardDrive className="size-4" />
            Storage
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">File storage</span>
            <span>Local (./uploads)</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Vector store</span>
            <span>{aiConfig?.vectorDb === "lancedb" ? aiConfig.lancedbPath : "Disabled"}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
