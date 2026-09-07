"use client";

import { useState, useCallback } from "react";
import {
  Search as SearchIcon,
  FileText,
  Sparkles,
  Loader2,
  FlaskConical,
  Stethoscope,
  User as UserIcon,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

type SearchResult = {
  documentId: string;
  slug: string;
  title: string;
  snippet: string;
  score: number;
  source: "text" | "semantic";
};

type TestHit = { name: string; href: string };
type ReportHit = { id: string; name: string; date: string | null; href: string };
type OrganHit = { key: string; name: string; href: string };
type PatientHit = { id: string; name: string; phone: string | null; email: string | null; linkStatus: "none" | "PENDING" | "GRANTED" | "REVOKED"; href: string };

type ApiResponse = {
  results: SearchResult[];
  tests: TestHit[];
  reports: ReportHit[];
  organs: OrganHit[];
  patients: PatientHit[];
};

const EMPTY: ApiResponse = { results: [], tests: [], reports: [], organs: [], patients: [] };

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [data, setData] = useState<ApiResponse>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setData(EMPTY);
      setSearched(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=20`);
      const json = (await res.json()) as Partial<ApiResponse>;
      setData({
        results: json.results ?? [],
        tests: json.tests ?? [],
        reports: json.reports ?? [],
        organs: json.organs ?? [],
        patients: json.patients ?? [],
      });
      setSearched(true);
    } catch {
      setData(EMPTY);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    doSearch(query);
  };

  const totalHits =
    data.results.length + data.tests.length + data.reports.length + data.organs.length + data.patients.length;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="font-heading text-3xl font-semibold tracking-tight">Search</h1>

      <form onSubmit={handleSubmit}>
        <div className="relative">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tests, reports, organs, notes..."
            className="pl-9 pr-4"
            autoFocus
          />
          {loading && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground animate-spin" />
          )}
        </div>
      </form>

      {searched && (
        <p className="text-sm text-muted-foreground">
          {totalHits} result{totalHits !== 1 ? "s" : ""} for &quot;{query}&quot;
        </p>
      )}

      {data.patients.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Patients</h2>
          <div className="space-y-2">
            {data.patients.map((p) => (
              <Link key={p.id} href={p.href}>
                <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
                  <CardContent className="py-3 flex items-center gap-3">
                    <div className="size-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <UserIcon className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm truncate">{p.name}</p>
                      <p className="text-xs text-muted-foreground truncate tabular-nums">
                        {p.phone ?? p.email ?? "—"}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-[10px] shrink-0 ${
                        p.linkStatus === "GRANTED"
                          ? "text-emerald-600 border-emerald-500/30 bg-emerald-500/10"
                          : p.linkStatus === "PENDING"
                          ? "text-amber-600 border-amber-500/30 bg-amber-500/10"
                          : ""
                      }`}
                    >
                      {p.linkStatus === "GRANTED" ? "Open" : p.linkStatus === "PENDING" ? "Pending" : "Request"}
                    </Badge>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      {data.tests.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Tests</h2>
          <div className="space-y-2">
            {data.tests.map((t) => (
              <Link key={t.name} href={t.href}>
                <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
                  <CardContent className="py-3 flex items-center gap-2">
                    <FlaskConical className="size-4 text-muted-foreground shrink-0" />
                    <span className="font-medium text-sm">{t.name}</span>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      {data.reports.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Reports</h2>
          <div className="space-y-2">
            {data.reports.map((r) => (
              <Link key={r.id} href={r.href}>
                <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
                  <CardContent className="py-3 flex items-center gap-2">
                    <FileText className="size-4 text-muted-foreground shrink-0" />
                    <span className="font-medium text-sm flex-1 truncate">{r.name}</span>
                    {r.date && (
                      <span className="text-xs text-muted-foreground shrink-0">
                        {new Date(r.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                      </span>
                    )}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      {data.organs.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Organ systems</h2>
          <div className="space-y-2">
            {data.organs.map((o) => (
              <Link key={o.key} href={o.href}>
                <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
                  <CardContent className="py-3 flex items-center gap-2">
                    <Stethoscope className="size-4 text-muted-foreground shrink-0" />
                    <span className="font-medium text-sm">{o.name}</span>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      {data.results.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Health records</h2>
          <div className="space-y-2">
            {data.results.map((result) => (
              <Link key={result.documentId} href={`/wiki/${result.slug}`}>
                <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
                  <CardContent className="py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <FileText className="size-4 text-muted-foreground shrink-0" />
                        <span className="font-medium text-sm">{result.title}</span>
                      </div>
                      {result.source === "semantic" && (
                        <Badge variant="outline" className="text-[10px] shrink-0">
                          <Sparkles className="size-2.5 mr-1" />
                          semantic
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2 pl-6">
                      {result.snippet}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      {searched && totalHits === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <SearchIcon className="size-12 mx-auto mb-4 opacity-30" />
          <p>No results found for &quot;{query}&quot;</p>
        </div>
      )}
    </div>
  );
}
