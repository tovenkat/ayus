"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import {
  Search, FileText, Activity, Pill, UtensilsCrossed, Stethoscope, Upload,
  LayoutDashboard, MessageSquare, Siren, ClipboardList, CreditCard, BookOpen,
  FlaskConical, Loader2, UserRound,
} from "lucide-react";

type Result = {
  documentId: string;
  slug: string;
  title: string;
  snippet: string;
  source: "text" | "semantic";
  score: number;
};

type TestHit = { name: string; href: string };
type ReportHit = { id: string; name: string; date: string | null; href: string };
type OrganHit = { key: string; name: string; href: string };
type PatientHit = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  linkStatus: "none" | "PENDING" | "GRANTED" | "REVOKED";
  href: string;
};

const NAV_ITEMS = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, keywords: "home overview" },
  { label: "Upload report", href: "/upload", icon: Upload, keywords: "pdf lab add" },
  { label: "Reports", href: "/reports", icon: FileText, keywords: "lab results" },
  { label: "Visit Prep", href: "/prep", icon: ClipboardList, keywords: "doctor appointment" },
  { label: "Emergency Card", href: "/emergency", icon: Siren, keywords: "first aid blood type allergies" },
  { label: "Medications", href: "/medications", icon: Pill, keywords: "drugs prescription" },
  { label: "Diet Planner", href: "/diet", icon: UtensilsCrossed, keywords: "food meal plan" },
  { label: "Doctor Notes", href: "/doctor-notes", icon: Stethoscope, keywords: "visit clinical" },
  { label: "Health Notes", href: "/wiki", icon: BookOpen, keywords: "wiki markdown pages" },
  { label: "Ask Ayus (chat)", href: "/chat", icon: MessageSquare, keywords: "ai copilot question" },
  { label: "Pricing", href: "/pricing", icon: CreditCard, keywords: "plans tier subscribe" },
];

export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [tests, setTests] = useState<TestHit[]>([]);
  const [reports, setReports] = useState<ReportHit[]>([]);
  const [organs, setOrgans] = useState<OrganHit[]>([]);
  const [patients, setPatients] = useState<PatientHit[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Toggle with Cmd/Ctrl+K or "/"
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "/" && !isTypingTarget(e.target)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Debounced search
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setTests([]);
      setReports([]);
      setOrgans([]);
      setPatients([]);
      setLoading(false);
      abortRef.current?.abort();
      return;
    }
    setLoading(true);
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=15`, { signal: ctrl.signal });
        if (!res.ok) return;
        const data = await res.json();
        setResults(data.results ?? []);
        setTests(data.tests ?? []);
        setReports(data.reports ?? []);
        setOrgans(data.organs ?? []);
        setPatients(data.patients ?? []);
      } catch {
        // ignore abort
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query, open]);

  function go(href: string) {
    setOpen(false);
    setQuery("");
    router.push(href);
  }

  function iconForTitle(title: string) {
    const t = title.toLowerCase();
    if (t.includes("lab report")) return FileText;
    if (t.includes("prescription") || t.includes("medication")) return Pill;
    if (t.includes("index") || t.includes("dashboard")) return LayoutDashboard;
    if (t.includes("note") || t.includes("visit")) return Stethoscope;
    return Activity;
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-2 text-muted-foreground justify-between md:min-w-65"
      >
        <span className="flex items-center gap-2">
          <Search className="size-3.5" />
          <span className="hidden sm:inline">Search tests, reports, organs…</span>
          <span className="sm:hidden">Search</span>
        </span>
        <kbd className="hidden md:inline-flex h-5 items-center gap-0.5 rounded border bg-muted px-1.5 text-[10px] font-mono">
          <span className="text-xs">⌘</span>K
        </kbd>
      </Button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search tests, reports, organs, notes…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
          <CommandEmpty>
            {loading ? (
              <span className="inline-flex items-center gap-2 text-sm">
                <Loader2 className="size-3.5 animate-spin" /> Searching…
              </span>
            ) : query.trim().length >= 2 ? (
              "No matches. Try different keywords."
            ) : (
              <span className="text-xs text-muted-foreground">
                Type to search tests, reports, organs, and notes…
              </span>
            )}
          </CommandEmpty>

          {/* Patients — only present for lab/doctor/hospital accounts (API-gated) */}
          {patients.length > 0 && (
            <>
              <CommandGroup heading="Patients">
                {patients.map((p) => (
                  <CommandItem
                    key={`patient-${p.id}`}
                    value={`patient ${p.name} ${p.phone ?? ""} ${p.email ?? ""}`}
                    onSelect={() => go(p.href)}
                  >
                    <UserRound className="size-4 text-primary" />
                    <span className="flex-1 truncate">{p.name}</span>
                    {(p.phone || p.email) && (
                      <span className="ml-2 truncate text-[10px] text-muted-foreground">
                        {p.phone ?? p.email}
                      </span>
                    )}
                    <span
                      className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        p.linkStatus === "GRANTED"
                          ? "bg-emerald-500/10 text-emerald-600"
                          : p.linkStatus === "PENDING"
                          ? "bg-amber-500/10 text-amber-600"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {p.linkStatus === "GRANTED"
                        ? "Open"
                        : p.linkStatus === "PENDING"
                        ? "Pending"
                        : "Request"}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
            </>
          )}

          {/* Tests */}
          {tests.length > 0 && (
            <>
              <CommandGroup heading="Tests">
                {tests.map((t) => (
                  <CommandItem
                    key={`test-${t.name}`}
                    value={`test ${t.name}`}
                    onSelect={() => go(t.href)}
                  >
                    <FlaskConical className="size-4 text-primary" />
                    <span className="flex-1 truncate">{t.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
            </>
          )}

          {/* Reports */}
          {reports.length > 0 && (
            <>
              <CommandGroup heading="Reports">
                {reports.map((r) => (
                  <CommandItem
                    key={`report-${r.id}`}
                    value={`report ${r.name}`}
                    onSelect={() => go(r.href)}
                  >
                    <FileText className="size-4 text-primary" />
                    <span className="flex-1 truncate">{r.name}</span>
                    {r.date && (
                      <span className="ml-2 text-[10px] text-muted-foreground">
                        {new Date(r.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
            </>
          )}

          {/* Organs */}
          {organs.length > 0 && (
            <>
              <CommandGroup heading="Organ systems">
                {organs.map((o) => (
                  <CommandItem
                    key={`organ-${o.key}`}
                    value={`organ ${o.name}`}
                    onSelect={() => go(o.href)}
                  >
                    <Stethoscope className="size-4 text-primary" />
                    <span className="flex-1 truncate">{o.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
            </>
          )}

          {/* Wiki search results */}
          {results.length > 0 && (
            <>
              <CommandGroup heading="Your health records">
                {results.map((r) => {
                  const Icon = iconForTitle(r.title);
                  return (
                    <CommandItem
                      key={r.documentId}
                      value={`${r.title} ${r.snippet}`}
                      onSelect={() => go(`/wiki/${r.slug}`)}
                    >
                      <Icon className="size-4 text-primary" />
                      <div className="flex-1 min-w-0">
                        <div className="truncate">{r.title}</div>
                        {r.snippet && (
                          <div className="text-[11px] text-muted-foreground truncate">{r.snippet}</div>
                        )}
                      </div>
                      {r.source === "semantic" && (
                        <span className="text-[10px] text-muted-foreground">~match</span>
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
              <CommandSeparator />
            </>
          )}

          {/* Always-visible hint when query is empty (matches phr v1 UX) */}
          {query.trim().length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              Type to search tests, reports, organs, and notes…
            </div>
          )}

          {/* Navigation */}
          <CommandGroup heading="Go to">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <CommandItem
                  key={item.href}
                  value={`${item.label} ${item.keywords}`}
                  onSelect={() => go(item.href)}
                >
                  <Icon className="size-4 text-muted-foreground" />
                  <span>{item.label}</span>
                  <CommandShortcut>{item.href}</CommandShortcut>
                </CommandItem>
              );
            })}
          </CommandGroup>

          {query.trim().length >= 2 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Actions">
                <CommandItem
                  value={`search all ${query}`}
                  onSelect={() => go(`/search?q=${encodeURIComponent(query)}`)}
                >
                  <Search className="size-4 text-muted-foreground" />
                  <span>See all matches for &quot;{query}&quot;</span>
                </CommandItem>
              </CommandGroup>
            </>
          )}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}
