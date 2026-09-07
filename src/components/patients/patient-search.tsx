"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Search as SearchIcon, Loader2, UserRound, ArrowRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export type LinkStatus = "none" | "PENDING" | "GRANTED" | "REVOKED";

export type PatientHit = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  linkStatus: LinkStatus;
  href: string;
};

export type RosterEntry = {
  id: string; // patientId
  name: string;
  phone: string | null;
  email: string | null;
  linkStatus: LinkStatus;
  href: string;
};

function StatusAction({
  hit,
  onRequest,
  pending,
}: {
  hit: PatientHit | RosterEntry;
  onRequest: (id: string) => void;
  pending: boolean;
}) {
  if (hit.linkStatus === "GRANTED") {
    return (
      <Button size="sm" variant="secondary" className="shrink-0" nativeButton={false} render={<Link href={hit.href} />}>
        Open <ArrowRight className="size-3.5" />
      </Button>
    );
  }
  if (hit.linkStatus === "PENDING") {
    return (
      <Button size="sm" variant="outline" disabled className="shrink-0 text-amber-600">
        Requested
      </Button>
    );
  }
  // none | REVOKED
  return (
    <Button
      size="sm"
      variant="outline"
      className="shrink-0"
      disabled={pending}
      onClick={() => onRequest(hit.id)}
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : "Request access"}
    </Button>
  );
}

function PatientRow({
  hit,
  onRequest,
  pending,
}: {
  hit: PatientHit | RosterEntry;
  onRequest: (id: string) => void;
  pending: boolean;
}) {
  return (
    <Card>
      <CardContent className="py-3 flex items-center gap-3">
        <div className="size-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <UserRound className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm truncate">{hit.name}</p>
          <p className="text-xs text-muted-foreground truncate tabular-nums">
            {hit.phone ?? hit.email ?? "—"}
          </p>
        </div>
        <StatusAction hit={hit} onRequest={onRequest} pending={pending} />
      </CardContent>
    </Card>
  );
}

export function PatientSearch({ initialRoster }: { initialRoster: RosterEntry[] }) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PatientHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [requesting, setRequesting] = useState<Set<string>>(new Set());
  // Local override of link status after a successful request, so both the
  // search list and the roster reflect the change without a refetch.
  const [statusOverride, setStatusOverride] = useState<Record<string, LinkStatus>>({});
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setSearched(false);
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
        setHits((data.patients ?? []) as PatientHit[]);
        setSearched(true);
      } catch {
        // aborted
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query]);

  async function requestAccess(patientId: string) {
    setRequesting((s) => new Set(s).add(patientId));
    try {
      const res = await fetch(`/api/patients/${patientId}/link`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not request access");
        return;
      }
      setStatusOverride((m) => ({ ...m, [patientId]: data.status as LinkStatus }));
      toast.success(
        data.status === "GRANTED" ? "Access already granted" : "Access requested — the patient will be asked to approve",
      );
    } catch {
      toast.error("Network error");
    } finally {
      setRequesting((s) => {
        const next = new Set(s);
        next.delete(patientId);
        return next;
      });
    }
  }

  const applyOverride = <T extends { id: string; linkStatus: LinkStatus }>(row: T): T =>
    statusOverride[row.id] ? { ...row, linkStatus: statusOverride[row.id] } : row;

  const roster = initialRoster.map(applyOverride);

  return (
    <div className="space-y-6">
      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search patients by name, phone, or email…"
          className="pl-9 pr-9"
          autoFocus
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground animate-spin" />
        )}
      </div>

      {/* Search results */}
      {query.trim().length >= 2 && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Search results
          </h2>
          {hits.length === 0 && searched && !loading ? (
            <p className="text-sm text-muted-foreground">No patients match “{query}”.</p>
          ) : (
            <div className="space-y-2">
              {hits.map(applyOverride).map((h) => (
                <PatientRow key={h.id} hit={h} onRequest={requestAccess} pending={requesting.has(h.id)} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Existing roster (granted + pending) */}
      {query.trim().length < 2 && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Your roster
          </h2>
          {roster.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No patients yet. Search above and request access to build your roster.
            </p>
          ) : (
            <div className="space-y-2">
              {roster.map((r) => (
                <PatientRow key={r.id} hit={r} onRequest={requestAccess} pending={requesting.has(r.id)} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
