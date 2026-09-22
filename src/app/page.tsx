import Link from "next/link";
import { auth } from "@/auth";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { AiDisclaimer } from "@/components/ui/ai-disclaimer";
import { PRICING } from "@/lib/pricing";
import {
  ArrowRight,
  ShieldCheck,
  Lock,
  FileText,
  Sparkles,
  Activity,
  Users,
  Building2,
  Stethoscope,
  FolderLock,
  Clock3,
  LineChart,
  Languages,
  Link as LinkIcon,
  Workflow,
  Cloud,
  Cpu,
  CircleCheck,
  Quote,
} from "lucide-react";

export const metadata = {
  title: "Ayus — Your health. In your hands. In your files.",
  description:
    "India's first file-over-app personal health record. AI reads your lab reports in seconds, organizes your history as markdown, and keeps it yours forever. DPDP Act compliant.",
};

export default async function LandingPage() {
  const session = await auth();
  // Logged-in users can browse the marketing page (the nav + CTAs switch to
  // "Go to Dashboard" below). Post-login navigation still lands on /dashboard
  // (the auth flow pushes there), so this only affects explicit visits to "/".
  const authed = !!session?.user;

  return (
    <div className="flex flex-col">
      <SiteNav authed={authed} />
      <Hero authed={authed} />
      <TrustStrip />
      <Problem />
      <HowItWorks />
      <Audiences />
      <PrivacySection />
      <FeatureGrid />
      <Testimonials />
      <PricingPreview />
      <FAQ />
      <FinalCTA authed={authed} />
      <SiteFooter />
    </div>
  );
}

// ─── Nav ────────────────────────────────────────────────────────────────────

function SiteNav({ authed }: { authed: boolean }) {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-backdrop-filter:bg-background/60">
      <div className="mx-auto max-w-6xl flex items-center justify-between px-4 py-3">
        <Link href="/"><Logo size="sm" /></Link>
        <nav className="hidden md:flex items-center gap-6 text-sm text-muted-foreground">
          <a href="#how" className="hover:text-foreground">How it works</a>
          <a href="#privacy" className="hover:text-foreground">Privacy</a>
          <Link href="/pricing" className="hover:text-foreground">Pricing</Link>
          <a href="#clinics" className="hover:text-foreground">For clinics</a>
        </nav>
        <div className="flex items-center gap-2">
          {authed ? (
            <Link href="/dashboard">
              <Button size="sm" className="gap-1.5">
                Go to Dashboard <ArrowRight className="size-3.5" />
              </Button>
            </Link>
          ) : (
            <>
              <Link href="/login">
                <Button variant="ghost" size="sm">Sign in</Button>
              </Link>
              <Link href="/register">
                <Button size="sm">Start free</Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

// ─── Hero ───────────────────────────────────────────────────────────────────

function Hero({ authed }: { authed: boolean }) {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,var(--tw-gradient-stops))] from-emerald-500/10 via-background to-background" />
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(to_right,rgba(16,185,129,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(16,185,129,0.04)_1px,transparent_1px)] bg-size-[44px_44px]" />

      <div className="mx-auto max-w-6xl px-4 pt-20 pb-24 text-center space-y-6">
        <Badge variant="outline" className="rounded-full px-3 py-1">
          <Sparkles className="mr-1.5 size-3" />
          Built in India · Designed with doctors · Private by default
        </Badge>

        <h1 className="font-heading text-5xl md:text-6xl font-semibold tracking-tight text-balance">
          Your family's health,{" "}
          <span className="bg-linear-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent">
            finally understood.
          </span>
        </h1>

        <p className="max-w-2xl mx-auto text-lg text-muted-foreground text-balance">
          Drop in lab reports from any doctor or lab. Ayus turns the numbers into
          a clear picture — so you know what&apos;s improving, what needs attention,
          and exactly what to ask at your next doctor visit.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          <Link href={authed ? "/dashboard" : "/register"}>
            <Button size="lg" className="gap-2">
              {authed ? "Go to your dashboard" : "Start free — no card required"}
              <ArrowRight className="size-4" />
            </Button>
          </Link>
          <a href="#how">
            <Button size="lg" variant="outline">See how it works</Button>
          </a>
        </div>

        <div className="flex flex-wrap justify-center gap-x-5 gap-y-2 pt-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><ShieldCheck className="size-3.5 text-emerald-600" /> Hospital-grade security</span>
          <span className="flex items-center gap-1.5"><Lock className="size-3.5 text-emerald-600" /> Never sold, never shared</span>
          <span className="flex items-center gap-1.5"><Clock3 className="size-3.5 text-emerald-600" /> Reads reports in seconds</span>
          <span className="flex items-center gap-1.5"><Activity className="size-3.5 text-emerald-600" /> Works with ABHA</span>
        </div>

        <HeroDemo />

        <div className="flex flex-wrap justify-center items-center gap-x-6 gap-y-2 pt-6 text-xs text-muted-foreground">
          <span>⭐️ 4.8 rating from early users</span>
          <span className="hidden sm:inline">·</span>
          <span>Used in <b className="text-foreground">clinics across Bengaluru &amp; Chennai</b></span>
          <span className="hidden sm:inline">·</span>
          <span><b className="text-foreground">30-day free trial</b>. Cancel anytime.</span>
        </div>
      </div>
    </section>
  );
}

function HeroDemo() {
  return (
    <div className="mt-10 mx-auto max-w-3xl">
      <div className="rounded-xl border bg-card shadow-xl overflow-hidden text-left">
        {/* Card header */}
        <div className="flex items-center justify-between gap-3 border-b bg-muted/30 px-5 py-3">
          <div className="flex items-center gap-2.5">
            <div className="size-8 rounded-md bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
              <Activity className="size-4" />
            </div>
            <div>
              <p className="text-sm font-medium leading-tight">Your sugar control</p>
              <p className="text-[11px] text-muted-foreground leading-tight">Latest reading · 18 April 2026</p>
            </div>
          </div>
          <Badge variant="outline" className="rounded-full text-[10px] border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/10">
            Slightly high · worth a check-in
          </Badge>
        </div>

        {/* Body: stat + tiny trend */}
        <div className="grid md:grid-cols-[1fr_1px_1fr] gap-0">
          <div className="p-5 space-y-2">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
              HbA1c (3-month sugar average)
            </p>
            <div className="flex items-baseline gap-2">
              <span className="font-heading text-5xl font-bold">6.8</span>
              <span className="text-sm text-muted-foreground">%</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Healthy range: <span className="font-medium text-foreground">4.0 – 5.6%</span>
            </p>
          </div>

          <div className="hidden md:block bg-border" />

          <div className="p-5 space-y-3 bg-muted/20">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Your trend — last 3 reports
            </p>
            <MiniTrend
              points={[
                { label: "Jul '25", value: 5.9, ok: true },
                { label: "Jan '26", value: 6.2, ok: false },
                { label: "Apr '26", value: 6.8, ok: false },
              ]}
            />
          </div>
        </div>

        {/* Insight footer */}
        <div className="border-t bg-linear-to-r from-emerald-500/5 via-background to-background px-5 py-3 flex items-start gap-2">
          <Sparkles className="size-4 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium">
              Your sugar control has drifted over the last 8 months.
            </p>
            <p className="text-xs text-muted-foreground">
              Ayus suggests talking to your doctor about this at your next visit — and reviewing your diet plan this week.
            </p>
          </div>
        </div>
      </div>
      <p className="text-center text-xs text-muted-foreground mt-3">
        One of many health markers Ayus tracks for you and your family. No medical jargon — just what it means.
      </p>
    </div>
  );
}

function MiniTrend({ points }: { points: { label: string; value: number; ok: boolean }[] }) {
  const max = Math.max(...points.map((p) => p.value));
  const min = Math.min(...points.map((p) => p.value));
  const range = max - min || 1;
  return (
    <div className="flex items-end justify-between gap-2 h-24">
      {points.map((p, i) => {
        const heightPct = ((p.value - min) / range) * 70 + 20;
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
            <span className="text-[11px] font-medium tabular-nums">{p.value}%</span>
            <div
              className={`w-full rounded-t-md ${p.ok ? "bg-emerald-500" : "bg-amber-500"}`}
              style={{ height: `${heightPct}%`, minHeight: 12 }}
            />
            <span className="text-[10px] text-muted-foreground">{p.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Trust strip ────────────────────────────────────────────────────────────

function TrustStrip() {
  return (
    <section className="border-y bg-muted/30">
      <div className="mx-auto max-w-6xl px-4 py-6 grid grid-cols-2 md:grid-cols-4 gap-6 text-center text-sm">
        <Stat value="30s" label="Per report with cloud AI" />
        <Stat value="44-page" label="Scanned PDFs handled" />
        <Stat value="100%" label="Markdown — no vendor lock-in" />
        <Stat value="₹99" label="Per month. Cancel anytime." />
      </div>
    </section>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="space-y-0.5">
      <p className="font-heading text-2xl font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

// ─── Problem framing ────────────────────────────────────────────────────────

function Problem() {
  const pains = [
    {
      icon: FileText,
      title: "Lab reports vanish into WhatsApp",
      body: "The PDF from last year's thyroid test? Somewhere in a family chat. Your doctor asks — you scroll for 20 minutes.",
    },
    {
      icon: Workflow,
      title: "Every doctor asks the same questions",
      body: "Medications, allergies, past surgeries. Retold at every visit. Nothing builds up.",
    },
    {
      icon: LineChart,
      title: "Trends are invisible",
      body: "Is your HbA1c rising? You'd never know — each report lives alone in a PDF.",
    },
  ];
  return (
    <section className="mx-auto max-w-6xl px-4 py-20">
      <div className="text-center space-y-3 mb-12">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">The problem</p>
        <h2 className="font-heading text-3xl md:text-4xl font-semibold text-balance">
          Your health is a story — told by scattered PDFs no one reads.
        </h2>
      </div>
      <div className="grid md:grid-cols-3 gap-4">
        {pains.map((p) => (
          <Card key={p.title}>
            <CardContent className="pt-6 space-y-3">
              <div className="size-10 rounded-lg bg-destructive/10 text-destructive flex items-center justify-center">
                <p.icon className="size-5" />
              </div>
              <h3 className="font-medium">{p.title}</h3>
              <p className="text-sm text-muted-foreground">{p.body}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

// ─── How it works ───────────────────────────────────────────────────────────

function HowItWorks() {
  const steps = [
    {
      step: "01",
      icon: FileText,
      title: "Drop in your lab report",
      body: "PDF, image, or scanned document. In any Indian lab format — Thyrocare, SRL, Apollo, Metropolis, local labs. We've tuned for all of them.",
    },
    {
      step: "02",
      icon: Sparkles,
      title: "AI reads it in 30 seconds",
      body: "Vision model extracts every test, value, reference range, and flag. You review and confirm — nothing gets filed without you.",
    },
    {
      step: "03",
      icon: LineChart,
      title: "Your wiki grows with you",
      body: "Every biomarker becomes a page. Every reading joins a history. See a decade of HbA1c at a glance. In markdown. In your own folder.",
    },
  ];
  return (
    <section id="how" className="bg-muted/30 border-y">
      <div className="mx-auto max-w-6xl px-4 py-20">
        <div className="text-center space-y-3 mb-12">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">How it works</p>
          <h2 className="font-heading text-3xl md:text-4xl font-semibold text-balance">
            From lab PDF to lifetime insight — in three steps.
          </h2>
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          {steps.map((s) => (
            <Card key={s.step} className="relative">
              <CardContent className="pt-6 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="size-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                    <s.icon className="size-5" />
                  </div>
                  <span className="font-heading text-3xl text-muted-foreground/40">{s.step}</span>
                </div>
                <h3 className="font-medium">{s.title}</h3>
                <p className="text-sm text-muted-foreground">{s.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Audiences ──────────────────────────────────────────────────────────────

function Audiences() {
  const groups = [
    {
      icon: Users,
      tag: "For individuals & families",
      title: "Finally, one place for your family's health",
      points: [
        "Track parents, kids, and yourself under one roof",
        "HbA1c, BP, cholesterol trends across years",
        "Never lose a prescription or report again",
      ],
      cta: { label: "Start free →", href: "/register" },
    },
    {
      icon: Stethoscope,
      tag: "For solo doctors & clinics",
      title: "Stop re-asking every patient their history",
      points: [
        "Patients bring a vault — not a pile of PDFs",
        "Branded patient wikis with your clinic logo",
        "GST invoicing, Razorpay billing, zero setup",
      ],
      cta: { label: "See Clinic Starter →", href: "/pricing" },
    },
    {
      icon: Building2,
      tag: "For diagnostic centers",
      title: "Turn reports into a paid AI add-on",
      points: [
        "Webhook integration with your LIS/HIS",
        "Deliver AI-summarized reports to patients",
        "DPDP-safe, multi-location admin, 12h SLA",
      ],
      cta: { label: "Book a 30-min demo →", href: "mailto:sales@phr.app?subject=Diagnostic%20center%20demo" },
    },
  ];
  return (
    <section id="clinics" className="mx-auto max-w-6xl px-4 py-20">
      <div className="text-center space-y-3 mb-12">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Built for the whole healthcare chain</p>
        <h2 className="font-heading text-3xl md:text-4xl font-semibold text-balance">
          One product. Three very different users. All of them winning.
        </h2>
      </div>
      <div className="grid md:grid-cols-3 gap-4">
        {groups.map((g) => (
          <Card key={g.tag} className="flex flex-col">
            <CardContent className="pt-6 space-y-4 flex-1 flex flex-col">
              <div className="space-y-2">
                <div className="size-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                  <g.icon className="size-5" />
                </div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">{g.tag}</p>
                <h3 className="font-heading text-xl font-semibold">{g.title}</h3>
              </div>
              <ul className="space-y-2 text-sm text-muted-foreground flex-1">
                {g.points.map((p) => (
                  <li key={p} className="flex gap-2 items-start">
                    <CircleCheck className="size-4 shrink-0 text-primary mt-0.5" />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
              <a href={g.cta.href} className="text-sm font-medium text-primary hover:underline">
                {g.cta.label}
              </a>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

// ─── Privacy / trust ────────────────────────────────────────────────────────

function PrivacySection() {
  return (
    <section id="privacy" className="bg-linear-to-b from-background to-blue-500/5 border-y">
      <div className="mx-auto max-w-6xl px-4 py-20 grid md:grid-cols-2 gap-10 items-center">
        <div className="space-y-4">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Why you should trust us</p>
          <h2 className="font-heading text-3xl md:text-4xl font-semibold text-balance">
            The health app that keeps your data even if we go away.
          </h2>
          <p className="text-muted-foreground">
            Every competitor stores your data in their database and charges you to get it back.
            We do the opposite. Your health wiki lives as plain markdown on your disk — inside a folder
            you can open, read, back up, and take with you. We're just the engine that keeps it
            growing. Lose us, keep your data. That's the promise.
          </p>
          <ul className="space-y-2 text-sm">
            <li className="flex gap-2 items-start">
              <FolderLock className="size-4 shrink-0 text-primary mt-0.5" />
              <span><b>File-over-app philosophy.</b> Your records are markdown files. Obsidian, VS Code, Notion — all can open them.</span>
            </li>
            <li className="flex gap-2 items-start">
              <Cpu className="size-4 shrink-0 text-primary mt-0.5" />
              <span><b>Privacy mode: 100% local.</b> Flip a switch and every extraction runs on your own machine. Zero cloud calls.</span>
            </li>
            <li className="flex gap-2 items-start">
              <ShieldCheck className="size-4 shrink-0 text-primary mt-0.5" />
              <span><b>DPDP Act ready.</b> Data stored in Mumbai (ap-south-1). Full audit trail. Right to erasure one click away.</span>
            </li>
            <li className="flex gap-2 items-start">
              <Lock className="size-4 shrink-0 text-primary mt-0.5" />
              <span><b>Bring your own key.</b> Use your own Gemini, OpenAI, or Claude key. We never see it unencrypted.</span>
            </li>
          </ul>
        </div>
        <Card>
          <CardContent className="pt-6 space-y-4">
            <Badge variant="outline" className="rounded-full">Our promises in writing</Badge>
            <ul className="space-y-3 text-sm">
              <PromiseRow label="We never train on your data." />
              <PromiseRow label="We never sell your data — not to advertisers, insurers, or anyone." />
              <PromiseRow label="We never hold your wiki hostage. It lives on your disk." />
              <PromiseRow label="Every extraction requires your explicit upload." />
              <PromiseRow label="You can export or delete everything, anytime, in one click." />
              <PromiseRow label="Every quarter we publish a transparency report." />
            </ul>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

function PromiseRow({ label }: { label: string }) {
  return (
    <li className="flex gap-2 items-start">
      <CircleCheck className="size-4 shrink-0 text-primary mt-0.5" />
      <span>{label}</span>
    </li>
  );
}

// ─── Feature grid ───────────────────────────────────────────────────────────

function FeatureGrid() {
  const features = [
    { icon: Sparkles, title: "Multi-provider AI", body: "Gemini, OpenAI, Claude, or 100% local Ollama. Switch anytime from settings." },
    { icon: LineChart, title: "Lifetime trend charts", body: "HbA1c, cholesterol, BP — see the arc, not the dots." },
    { icon: LinkIcon, title: "Obsidian graph view", body: "Your biomarkers, doctors, conditions — visually connected." },
    { icon: Activity, title: "ABHA-ready roadmap", body: "Link your national health ID. Sync with India's digital health stack." },
    { icon: Languages, title: "Indian lab formats", body: "Thyrocare, SRL, Apollo, Metropolis, your neighbourhood lab — we read them all." },
    { icon: Cloud, title: "Razorpay & UPI", body: "₹99/month via UPI, cards, netbanking. Auto-renew. GST invoices." },
    { icon: Clock3, title: "30-day free trial", body: "Five reports on us. No card required to start." },
    { icon: Users, title: "Family vaults", body: "Up to 5 members on one subscription. Each person's data isolated." },
  ];
  return (
    <section className="mx-auto max-w-6xl px-4 py-20">
      <div className="text-center space-y-3 mb-12">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Features</p>
        <h2 className="font-heading text-3xl md:text-4xl font-semibold text-balance">
          Everything a personal health record should do.
        </h2>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {features.map((f) => (
          <Card key={f.title}>
            <CardContent className="pt-6 space-y-2">
              <f.icon className="size-5 text-primary" />
              <h3 className="font-medium text-sm">{f.title}</h3>
              <p className="text-xs text-muted-foreground">{f.body}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

// ─── Testimonials ───────────────────────────────────────────────────────────

function Testimonials() {
  const quotes = [
    {
      quote: "I used to waste 15 minutes at every appointment retelling my diabetic mother's history. Now I just share her wiki link.",
      name: "Priya N.",
      role: "Caregiver · Bengaluru",
    },
    {
      quote: "Our diagnostic center delivers the lab PDF plus an AI summary wiki to every patient. It's our biggest differentiator in 18 years.",
      name: "Dr. Raghavan",
      role: "Apex Diagnostics · Chennai",
    },
    {
      quote: "I tested 6 health record apps. Only this one lets me keep my data in plain markdown. That's non-negotiable for me.",
      name: "Arun S.",
      role: "Software engineer · Hyderabad",
    },
  ];
  return (
    <section className="bg-muted/30 border-y">
      <div className="mx-auto max-w-6xl px-4 py-20">
        <div className="text-center space-y-3 mb-12">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">What users say</p>
          <h2 className="font-heading text-3xl md:text-4xl font-semibold">Trusted by people who take their health seriously.</h2>
          <p className="text-xs text-muted-foreground">* Early-access quotes, shared with permission.</p>
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          {quotes.map((q) => (
            <Card key={q.name}>
              <CardContent className="pt-6 space-y-4">
                <Quote className="size-5 text-primary" />
                <p className="text-sm leading-relaxed">{q.quote}</p>
                <div className="pt-2 border-t">
                  <p className="text-sm font-medium">{q.name}</p>
                  <p className="text-xs text-muted-foreground">{q.role}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Pricing preview ────────────────────────────────────────────────────────

function PricingPreview() {
  const tiers: (keyof typeof PRICING)[] = ["PERSONAL", "CLINIC_STARTER", "DIAGNOSTIC_CENTER"];
  return (
    <section className="mx-auto max-w-6xl px-4 py-20">
      <div className="text-center space-y-3 mb-12">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Pricing</p>
        <h2 className="font-heading text-3xl md:text-4xl font-semibold text-balance">
          Simple plans. Real prices. No sneaky overages.
        </h2>
      </div>
      <div className="grid md:grid-cols-3 gap-4">
        {tiers.map((id) => {
          const t = PRICING[id];
          const featured = id === "CLINIC_STARTER";
          return (
            <Card key={id} className={featured ? "border-primary ring-1 ring-primary/20" : ""}>
              <CardContent className="pt-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-heading text-xl font-semibold">{t.label}</h3>
                  {featured && <Badge>Most popular</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">{t.targetPersona}</p>
                <div className="flex items-baseline gap-1 pt-2">
                  <span className="text-3xl font-heading font-semibold">₹{t.priceInrPerMonth.toLocaleString("en-IN")}</span>
                  <span className="text-sm text-muted-foreground">/month</span>
                </div>
                <ul className="space-y-1.5 text-sm text-muted-foreground">
                  {t.features.slice(0, 3).map((f) => (
                    <li key={f} className="flex gap-2 items-start">
                      <CircleCheck className="size-4 shrink-0 text-primary mt-0.5" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <div className="text-center mt-8">
        <Link href="/pricing">
          <Button variant="outline">See all plans & enterprise options →</Button>
        </Link>
      </div>
    </section>
  );
}

// ─── FAQ ────────────────────────────────────────────────────────────────────

function FAQ() {
  const faqs = [
    {
      q: "Is my health data really safe?",
      a: "Yes. Your markdown files live on your disk — we only keep an encrypted mirror for fast search and web access. Storage is in Mumbai (ap-south-1), DPDP Act compliant. You can flip 'Privacy mode' to run every AI call locally on your own machine.",
    },
    {
      q: "What if I cancel? Do I lose my data?",
      a: "No. Every line of your wiki is already on your computer as plain markdown. Cancelling just stops the AI. Your folder is yours. Open it in Obsidian or Notepad — same files, same content.",
    },
    {
      q: "Does it work with Indian labs?",
      a: "Yes. We've specifically tuned our parser for Thyrocare, SRL, Apollo, Metropolis, Dr Lal PathLabs, and dozens of smaller labs. If your lab issues a PDF, we can read it.",
    },
    {
      q: "What about my grandparent? Can I manage their records?",
      a: "The Family plan lets you add up to 5 members. Each person's records stay isolated — you just have admin access. Perfect for multi-generational Indian families.",
    },
    {
      q: "Can my diagnostic center integrate this?",
      a: "Yes. The Diagnostic Center plan includes REST API access and webhooks so your LIS or HIS can push reports directly. We'll help you set it up — most centers are live in under a week.",
    },
    {
      q: "Do you use my data to train AI?",
      a: "Never. Your reports are processed and discarded from the AI provider's side. We don't store them with third parties. Bring your own key and we never see the raw upload at all.",
    },
    {
      q: "What if I don't trust cloud AI at all?",
      a: "Set Privacy Mode in settings. Every extraction runs locally via Ollama on your own hardware. Slower, but zero cloud calls. You're still on our interface — the AI just never leaves your laptop.",
    },
    {
      q: "Do you support Hindi / Tamil / Telugu?",
      a: "Not in the UI yet — it's on the roadmap. The AI already handles Indian-English report formats perfectly, which is how 98% of Indian labs print.",
    },
  ];
  return (
    <section className="bg-muted/30 border-y">
      <div className="mx-auto max-w-3xl px-4 py-20 space-y-8">
        <div className="text-center space-y-3">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Questions</p>
          <h2 className="font-heading text-3xl md:text-4xl font-semibold">Everything people ask us.</h2>
        </div>
        <div className="space-y-3">
          {faqs.map((f) => (
            <details key={f.q} className="rounded-lg border bg-card p-4 group">
              <summary className="cursor-pointer font-medium text-sm list-none flex items-center justify-between">
                {f.q}
                <span className="text-muted-foreground group-open:rotate-45 transition-transform">+</span>
              </summary>
              <p className="text-sm text-muted-foreground mt-3">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Final CTA ──────────────────────────────────────────────────────────────

function FinalCTA({ authed }: { authed: boolean }) {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 -z-10 bg-linear-to-br from-blue-600 to-indigo-600" />
      <div className="mx-auto max-w-4xl px-4 py-20 text-center space-y-6 text-white">
        <h2 className="font-heading text-3xl md:text-5xl font-semibold text-balance">
          Own your health story. Starting today.
        </h2>
        <p className="max-w-xl mx-auto text-white/80 text-balance">
          Five reports on us. No card required. If we don't become the last health app you sign up for,
          take your markdown folder and leave — no hard feelings.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          <Link href={authed ? "/dashboard" : "/register"}>
            <Button size="lg" variant="secondary" className="gap-2">
              {authed ? "Go to your dashboard" : "Start free"}
              <ArrowRight className="size-4" />
            </Button>
          </Link>
          <a href="mailto:sales@phr.app?subject=Diagnostic%20center%20demo">
            <Button size="lg" variant="outline" className="bg-transparent text-white border-white/30 hover:bg-white/10">
              I run a clinic / diagnostic center
            </Button>
          </a>
        </div>
      </div>
    </section>
  );
}

// ─── Footer ─────────────────────────────────────────────────────────────────

function SiteFooter() {
  return (
    <footer className="border-t bg-background">
      <div className="mx-auto max-w-6xl px-4 py-10 grid md:grid-cols-4 gap-8 text-sm">
        <div className="space-y-3 md:col-span-2">
          <Logo size="sm" />
          <p className="text-xs text-muted-foreground max-w-xs">
            The file-over-app personal health record, built in India for India.
            Your data. Your files. Forever yours.
          </p>
        </div>
        <div className="space-y-2">
          <p className="font-medium">Product</p>
          <ul className="space-y-1.5 text-muted-foreground">
            <li><a href="#how" className="hover:text-foreground">How it works</a></li>
            <li><Link href="/pricing" className="hover:text-foreground">Pricing</Link></li>
            <li><a href="#privacy" className="hover:text-foreground">Privacy</a></li>
            <li><a href="#clinics" className="hover:text-foreground">For clinics</a></li>
          </ul>
        </div>
        <div className="space-y-2">
          <p className="font-medium">Company</p>
          <ul className="space-y-1.5 text-muted-foreground">
            <li><a href="mailto:hello@phr.app" className="hover:text-foreground">Contact</a></li>
            <li><a href="mailto:sales@phr.app" className="hover:text-foreground">Sales</a></li>
            <li><a href="/privacy-policy" className="hover:text-foreground">Privacy policy</a></li>
            <li><a href="/terms" className="hover:text-foreground">Terms</a></li>
          </ul>
        </div>
      </div>
      <div className="mx-auto max-w-6xl px-2"><AiDisclaimer variant="footer" /></div>
      <div className="border-t">
        <div className="mx-auto max-w-6xl px-4 py-4 flex flex-col sm:flex-row justify-between items-center gap-2 text-xs text-muted-foreground">
          <p>© 2026 Ayus. Built in Bengaluru 🇮🇳</p>
          <p>DPDP Act compliant · Data hosted in Mumbai (ap-south-1)</p>
        </div>
      </div>
    </footer>
  );
}
