import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { PRICING, PUBLIC_TIERS, MODELS, estimateReportCost } from "@/lib/pricing";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UpgradeButton } from "@/components/pricing/upgrade-button";
import { Check, Shield, Zap, Building2, Sparkles, Lock } from "lucide-react";
import type { AiProvider, SubscriptionTier } from "@prisma/client";

export const metadata = {
  title: "Pricing — Ayus",
  description: "Transparent pricing for personal, clinic, and diagnostic-center tiers.",
};

const FEATURED = "CLINIC_STARTER";

export default async function PricingPage() {
  const session = await auth();
  let currentTier: SubscriptionTier | null = null;
  if (session?.user?.id) {
    const membership = await prisma.organizationMember.findFirst({
      where: { userId: session.user.id, role: "OWNER" },
      orderBy: { createdAt: "asc" },
      select: { organization: { select: { subscription: { select: { tier: true } } } } },
    });
    currentTier = membership?.organization.subscription?.tier ?? null;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 space-y-12">
      <header className="text-center space-y-3">
        <h1 className="text-4xl font-semibold tracking-tight">Pricing built for Indian healthcare</h1>
        <p className="text-muted-foreground max-w-2xl mx-auto">
          From individual patients to multi-location diagnostic centers. All plans include Obsidian-compatible local vaults,
          DPDP-compliant storage in Mumbai (ap-south-1), and GST invoicing.
        </p>
        <div className="flex justify-center gap-6 pt-2 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5"><Shield className="size-4" />DPDP Act ready</span>
          <span className="flex items-center gap-1.5"><Zap className="size-4" />~30s per report</span>
          <span className="flex items-center gap-1.5"><Building2 className="size-4" />ABHA-ready (roadmap)</span>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {PUBLIC_TIERS.map((id) => {
          const t = PRICING[id];
          const featured = id === FEATURED;
          const isEnterprise = id === "ENTERPRISE";
          return (
            <Card key={id} className={featured ? "border-primary shadow-md ring-1 ring-primary/20" : ""}>
              <CardHeader className="space-y-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">{t.label}</CardTitle>
                  {featured && <Badge>Most popular</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">{t.targetPersona}</p>
                <div className="pt-2">
                  {isEnterprise ? (
                    <p className="text-2xl font-semibold">Custom</p>
                  ) : t.priceInrPerMonth === 0 ? (
                    <p className="text-2xl font-semibold">Free</p>
                  ) : (
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-semibold">₹{t.priceInrPerMonth.toLocaleString("en-IN")}</span>
                      <span className="text-sm text-muted-foreground">/month</span>
                    </div>
                  )}
                  {!isEnterprise && t.priceInrPerYear > 0 && (
                    <p className="text-xs text-muted-foreground pt-0.5">
                      ₹{t.priceInrPerYear.toLocaleString("en-IN")}/year (save ~15%)
                    </p>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-2 text-sm">
                  {t.features.map((f) => (
                    <li key={f} className="flex gap-2 items-start">
                      <Check className="size-4 text-primary shrink-0 mt-0.5" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <div className="border-t pt-3 text-xs text-muted-foreground space-y-1">
                  {t.reportsPerMonth > 0 && <div>📄 {t.reportsPerMonth.toLocaleString("en-IN")} reports/month</div>}
                  {t.membersIncluded > 0 && <div>👥 Up to {t.membersIncluded} members</div>}
                  {t.byokAllowed && <div>🔑 Bring your own key (BYOK)</div>}
                  {t.apiAccess && <div>⚡ REST API access</div>}
                  {t.slaHours !== null && <div>🎯 {t.slaHours}h SLA</div>}
                </div>
                {isEnterprise ? (
                  <a href="mailto:sales@phr.app?subject=Enterprise%20inquiry" className="block">
                    <Button className="w-full" variant="outline">Contact sales</Button>
                  </a>
                ) : session?.user ? (
                  <UpgradeButton
                    tier={id as SubscriptionTier}
                    label={`Switch to ${t.label}`}
                    variant={featured ? "default" : "outline"}
                    className="w-full"
                    currentTier={currentTier ?? undefined}
                  />
                ) : t.priceInrPerMonth === 0 ? (
                  <Link href="/register" className="block">
                    <Button className="w-full" variant="outline">Start free</Button>
                  </Link>
                ) : (
                  <Link href={`/register?tier=${id}`} className="block">
                    <Button className="w-full" variant={featured ? "default" : "outline"}>Choose {t.label}</Button>
                  </Link>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <ProviderCompare />

      <section className="border rounded-lg p-6 bg-muted/30 space-y-3">
        <h2 className="text-lg font-semibold">For diagnostic centers & hospital groups</h2>
        <p className="text-sm text-muted-foreground">
          Integrate AI-powered lab report processing into your existing workflow. White-labelled patient wikis,
          webhook-driven delivery, and on-prem deployment options for data-sensitive environments.
        </p>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground pt-1">
          <Badge variant="outline">DPDP Act compliant</Badge>
          <Badge variant="outline">GST invoicing</Badge>
          <Badge variant="outline">BYOK (Gemini/OpenAI/Claude)</Badge>
          <Badge variant="outline">FHIR export</Badge>
          <Badge variant="outline">ABHA-ready roadmap</Badge>
        </div>
        <a href="mailto:sales@phr.app?subject=Diagnostic%20center%20demo">
          <Button>Book a 30-min demo</Button>
        </a>
      </section>

      <section className="text-center text-xs text-muted-foreground">
        All prices in INR, exclusive of GST. Paid via Razorpay (UPI / card / netbanking).
        Enterprise billing available in INR, USD, or via MSA.
      </section>
    </div>
  );
}

// ─── Provider comparison ────────────────────────────────────────────────────

const PROVIDER_LABELS: Partial<Record<AiProvider, { name: string; blurb: string }>> = {
  OLLAMA_LOCAL: { name: "Local (Ollama)", blurb: "100% offline. You run it. Zero marginal cost, but slower." },
  GEMINI: { name: "Google Gemini", blurb: "Cheapest cloud. Native PDF ingest. Best price/quality." },
  OPENAI: { name: "OpenAI", blurb: "Well-known brand. Strong structured output. Mid-tier cost." },
  CLAUDE: { name: "Anthropic Claude", blurb: "Best accuracy on medical tables. Premium pricing." },
};

function ProviderCompare() {
  // Show the most popular model per provider for Personal tier comparison
  const featuredIds = [
    "qwen2.5:7b-instruct",
    "gemini-2.5-flash",
    "gpt-4o-mini",
    "claude-haiku-4-5-20251001",
  ];
  const rows = featuredIds.map((id) => MODELS.find((m) => m.id === id)!).filter(Boolean);

  return (
    <section className="space-y-6 py-8 border-t">
      <div className="text-center space-y-2">
        <div className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <Sparkles className="size-3.5" />
          Choose any AI provider — or bring your own key
        </div>
        <h2 className="text-2xl font-semibold">Pick the brain. We handle the pipes.</h2>
        <p className="text-muted-foreground text-sm max-w-2xl mx-auto">
          Every paid tier lets you choose your AI provider for each extraction. Use ours, or paste
          your own API key and we'll route through it — we never see the key unencrypted.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="px-4 py-3 font-medium">Provider & model</th>
              <th className="px-4 py-3 font-medium">Why pick it</th>
              <th className="px-4 py-3 font-medium text-right">Cost / text report</th>
              <th className="px-4 py-3 font-medium text-right">Cost / scanned 40-page PDF</th>
              <th className="px-4 py-3 font-medium">Available from</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const label = PROVIDER_LABELS[m.provider];
              const text = estimateReportCost(m.id);
              const scanned = estimateReportCost(m.id, { scanned: true });
              return (
                <tr key={m.id} className="border-t">
                  <td className="px-4 py-3">
                    <div className="font-medium">{label?.name ?? m.provider}</div>
                    <div className="text-xs text-muted-foreground font-mono">{m.id}</div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{label?.blurb}</td>
                  <td className="px-4 py-3 text-right font-mono">
                    {m.provider === "OLLAMA_LOCAL" ? "Free*" : `₹${text.retailInr.toFixed(2)}`}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {m.provider === "OLLAMA_LOCAL" ? "Free*" : `₹${scanned.retailInr.toFixed(2)}`}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className="text-xs">
                      {PRICING[m.tierMin].label}
                    </Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-start gap-3 text-xs text-muted-foreground max-w-3xl mx-auto">
        <Lock className="size-3.5 shrink-0 mt-0.5" />
        <p>
          Retail cost includes our infra + support margin. Using your own API key (BYOK) on
          Personal tier or above bypasses this — you pay the provider directly and we charge only
          the flat subscription. <span className="font-medium">* Local</span> runs free at
          inference but needs Ollama installed on your machine.
        </p>
      </div>
    </section>
  );
}
