"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, UserRound, ArrowRight } from "lucide-react";
import { VaultUpload } from "@/components/upload/vault-upload";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export type RosterPatient = {
  id: string;
  name: string | null;
  contact: string | null;
};

/**
 * Roster upload-on-behalf-of. A lab/doctor/hospital picks one of their
 * CONSENTED patients, then the standard VaultUpload posts the report scoped to
 * that patient (server re-checks the GRANTED link). Uploading for oneself makes
 * no sense for a roster account, so a patient MUST be selected first.
 */
export function RosterUpload({ patients }: { patients: RosterPatient[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return patients;
    return patients.filter(
      (p) =>
        (p.name ?? "").toLowerCase().includes(q) ||
        (p.contact ?? "").toLowerCase().includes(q),
    );
  }, [patients, query]);

  const selected = patients.find((p) => p.id === selectedId) ?? null;

  if (patients.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 flex flex-col items-center text-center gap-3">
          <div className="size-12 rounded-full bg-primary/10 text-primary flex items-center justify-center">
            <UserRound className="size-6" />
          </div>
          <div>
            <p className="font-medium">No consented patients yet</p>
            <p className="text-sm text-muted-foreground max-w-sm mt-1">
              You can only upload reports for patients who have granted you access.
              Find a patient and request access first.
            </p>
          </div>
          <Link
            href="/patients"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            Go to roster <ArrowRight className="size-4" />
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Step 1 — choose a patient */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">
            1
          </span>
          <h2 className="text-sm font-semibold">Choose a patient</h2>
        </div>

        {selected ? (
          <Card>
            <CardContent className="py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="size-9 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <UserRound className="size-4" />
                </div>
                <div className="min-w-0">
                  <p className="font-medium truncate">{selected.name ?? "(unnamed patient)"}</p>
                  {selected.contact && (
                    <p className="text-xs text-muted-foreground tabular-nums truncate">{selected.contact}</p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="text-xs text-primary hover:underline shrink-0"
              >
                Change
              </button>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search your consented patients…"
                className="border-input focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded-md border bg-transparent py-2 pl-9 pr-3 text-sm outline-none focus-visible:ring-[3px]"
              />
            </div>
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="text-sm text-muted-foreground px-1 py-2">No patients match “{query}”.</p>
              ) : (
                filtered.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedId(p.id)}
                    className="w-full text-left"
                  >
                    <Card className="transition hover:bg-muted/40 cursor-pointer">
                      <CardContent className="py-2.5 flex items-center gap-3">
                        <div className="size-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                          <UserRound className="size-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{p.name ?? "(unnamed patient)"}</p>
                          {p.contact && (
                            <p className="text-xs text-muted-foreground tabular-nums truncate">{p.contact}</p>
                          )}
                        </div>
                        <Badge variant="outline" className="text-emerald-600 border-emerald-500/30 bg-emerald-500/10 shrink-0">
                          Consented
                        </Badge>
                      </CardContent>
                    </Card>
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </div>

      {/* Step 2 — upload for the chosen patient */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span
            className={`flex size-6 items-center justify-center rounded-full text-xs font-semibold ${
              selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}
          >
            2
          </span>
          <h2 className={`text-sm font-semibold ${selected ? "" : "text-muted-foreground"}`}>
            Upload the report
          </h2>
        </div>

        {selected ? (
          // key forces a fresh upload widget per patient (resets state on change)
          <VaultUpload key={selected.id} patientId={selected.id} />
        ) : (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            Select a patient above to upload their report.
          </div>
        )}
      </div>
    </div>
  );
}
