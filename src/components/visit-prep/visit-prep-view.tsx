"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Sparkles, Printer, Loader2, AlertTriangle, TrendingUp, TrendingDown, Minus,
  HelpCircle, Pill, FileText, UtensilsCrossed, Stethoscope, Clock, Download,
} from "lucide-react";
import { ShareButton } from "@/components/share/share-button";
import { Sparkline } from "@/components/visit-prep/sparkline";

type BiomarkerReading = {
  name: string;
  latest: { value: string; unit: string | null; interpretation: string; date: string };
  previous: { value: string; date: string } | null;
  trend: "improving" | "worsening" | "stable" | "unknown";
  isOutOfRange: boolean;
  referenceLow: number | null;
  referenceHigh: number | null;
  history: { date: string; value: number }[];
};

type VisitPrep = {
  generatedAt: string;
  headline: string;
  narrativeSummary: string;
  redFlags: string[];
  questionsToAsk: string[];
  activeMedications: { name: string; dosage: string | null; frequency: string; notes?: string | null }[];
  recentBiomarkers: BiomarkerReading[];
  outOfRangeBiomarkers: BiomarkerReading[];
  activeDiet: { mealType: string; time: string; items: string }[];
  lastVisit: { date: string; doctorName: string | null; summary: string | null } | null;
};

const TrendIcon = ({ trend }: { trend: BiomarkerReading["trend"] }) => {
  if (trend === "improving") return <TrendingUp className="size-3.5 text-emerald-600" />;
  if (trend === "worsening") return <TrendingDown className="size-3.5 text-destructive" />;
  if (trend === "stable") return <Minus className="size-3.5 text-muted-foreground" />;
  return null;
};

function slugifyName(s: string): string {
  return s.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "patient";
}

function downloadAsPdf(patientName: string) {
  const genDate = new Date().toISOString().split("T")[0];
  const pdfName = `VisitPrep_${slugifyName(patientName)}_${genDate}`;
  const originalTitle = document.title;
  // Browsers use document.title as the default PDF filename on Save-as-PDF
  document.title = pdfName;
  const restore = () => { document.title = originalTitle; window.removeEventListener("afterprint", restore); };
  window.addEventListener("afterprint", restore);
  window.print();
  // Safety fallback — afterprint doesn't always fire on all browsers
  setTimeout(restore, 2000);
}

export function VisitPrepView({
  patientName,
  patientId,
  showShare = true,
}: {
  patientName: string;
  /** Roster (doctor/hospital) view: generate prep for this consented patient. */
  patientId?: string;
  /** Sharing is a personal action — hidden in the roster patient view. */
  showShare?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [prep, setPrep] = useState<VisitPrep | null>(null);
  const forPatient = !!patientId;

  async function generate() {
    setLoading(true);
    setPrep(null);
    try {
      const res = await fetch("/api/visit-prep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patientId ? { patientId } : {}),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't generate visit prep");
        return;
      }
      setPrep(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  if (!prep) {
    return (
      <Card>
        <CardContent className="py-10 text-center space-y-4">
          <div className="mx-auto size-14 rounded-full bg-primary/10 text-primary flex items-center justify-center">
            <Stethoscope className="size-6" />
          </div>
          <div>
            <h2 className="font-heading text-lg font-semibold">
              {forPatient ? `Prep for ${patientName}'s visit` : "Prep for your next doctor visit"}
            </h2>
            <p className="text-sm text-muted-foreground max-w-md mx-auto pt-1">
              One-page summary built from {forPatient ? "the patient's" : "your"} latest lab trends,
              active medications, diet, and last visit.
              {forPatient ? " Print or hand it over at the consult." : " Print it and walk in ready."}
            </p>
          </div>
          <Button onClick={generate} disabled={loading} size="lg">
            {loading ? (
              <><Loader2 className="mr-2 size-4 animate-spin" />Reading your history…</>
            ) : (
              <><Sparkles className="mr-2 size-4" />Generate prep</>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4 print:space-y-2">
      {/* Action bar (hidden in print) */}
      <div className="flex items-center justify-between print:hidden">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Clock className="size-3.5" />
          <span>Generated {new Date(prep.generatedAt).toLocaleString()}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" onClick={() => downloadAsPdf(patientName)}>
            <Download className="mr-2 size-4" />Download PDF
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="mr-2 size-4" />Print
          </Button>
          <Button variant="ghost" size="sm" onClick={generate}>
            <Sparkles className="mr-2 size-4" />Regenerate
          </Button>
          {showShare && (
            <ShareButton
              resource="VISIT_PREP"
              snapshotJson={prep}
              label="Visit Prep"
              buttonLabel="Share via WhatsApp"
            />
          )}
        </div>
      </div>

      {/* Print-only header */}
      <div className="hidden print:block border-b pb-3 mb-3">
        <h1 className="text-2xl font-semibold">{patientName} — Doctor Visit Prep</h1>
        <p className="text-sm text-muted-foreground">Generated {new Date(prep.generatedAt).toLocaleDateString()}</p>
      </div>

      {/* Headline */}
      <Card className="print:border-none print:shadow-none">
        <CardContent className="py-4">
          <p className="font-heading text-lg font-semibold">{prep.headline}</p>
        </CardContent>
      </Card>

      {/* Red flags */}
      {prep.redFlags.length > 0 && (
        <Card className="border-destructive/30 bg-destructive/5 print:border-destructive print:border print:shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5 text-destructive">
              <AlertTriangle className="size-4" />Priority flags
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="space-y-1 text-sm">
              {prep.redFlags.map((f, i) => <li key={i}>• {f}</li>)}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Clinical summary */}
      <Card className="print:border-none print:shadow-none">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <FileText className="size-4" />Clinical summary
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 text-sm whitespace-pre-line">
          {prep.narrativeSummary}
        </CardContent>
      </Card>

      {/* Out-of-range biomarkers table */}
      {prep.outOfRangeBiomarkers.length > 0 && (
        <Card className="print:border-none print:shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <AlertTriangle className="size-4 text-amber-600" />Out-of-range biomarkers ({prep.outOfRangeBiomarkers.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="text-left border-b">
                  <th className="py-1.5 pr-2 font-medium">Test</th>
                  <th className="py-1.5 pr-2 font-medium">Latest</th>
                  <th className="py-1.5 pr-2 font-medium">Status</th>
                  <th className="py-1.5 pr-2 font-medium">Previous</th>
                  <th className="py-1.5 pr-2 font-medium">History</th>
                  <th className="py-1.5 font-medium">Trend</th>
                </tr>
              </thead>
              <tbody>
                {prep.outOfRangeBiomarkers.map((b) => (
                  <tr key={b.name} className="border-b last:border-b-0">
                    <td className="py-1.5 pr-2 font-medium">{b.name}</td>
                    <td className="py-1.5 pr-2 tabular-nums">{b.latest.value} {b.latest.unit ?? ""} <span className="text-muted-foreground text-xs">({b.latest.date})</span></td>
                    <td className="py-1.5 pr-2">
                      <Badge variant="outline" className="text-[10px] border-destructive/40 text-destructive">{b.latest.interpretation}</Badge>
                    </td>
                    <td className="py-1.5 pr-2 text-muted-foreground tabular-nums">
                      {b.previous ? `${b.previous.value} (${b.previous.date})` : "—"}
                    </td>
                    <td className="py-1.5 pr-2">
                      <Sparkline
                        points={b.history}
                        referenceLow={b.referenceLow}
                        referenceHigh={b.referenceHigh}
                        trendWorse={b.trend === "worsening"}
                      />
                    </td>
                    <td className="py-1.5 flex items-center gap-1 capitalize">
                      <TrendIcon trend={b.trend} />
                      {b.trend !== "unknown" ? b.trend : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[10px] text-muted-foreground mt-2">
              Shaded band in sparklines = reference range. Last {Math.min(10, Math.max(...prep.outOfRangeBiomarkers.map((b) => b.history.length)))} readings.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Questions to ask */}
      {prep.questionsToAsk.length > 0 && (
        <Card className="print:border-none print:shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <HelpCircle className="size-4" />Questions to ask your doctor
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ol className="space-y-1.5 text-sm list-decimal list-inside marker:text-muted-foreground">
              {prep.questionsToAsk.map((q, i) => <li key={i}>{q}</li>)}
            </ol>
          </CardContent>
        </Card>
      )}

      {/* Medications */}
      {prep.activeMedications.length > 0 && (
        <Card className="print:border-none print:shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <Pill className="size-4" />Active medications ({prep.activeMedications.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="space-y-1 text-sm">
              {prep.activeMedications.map((m, i) => (
                <li key={i}>
                  <span className="font-medium">{m.name}</span>
                  {m.dosage && <span className="text-muted-foreground"> · {m.dosage}</span>}
                  <span className="text-muted-foreground"> · {m.frequency.toLowerCase().replace(/_/g, " ")}</span>
                  {m.notes && <span className="text-muted-foreground"> — {m.notes}</span>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Recent biomarkers (non-flagged) */}
      {prep.recentBiomarkers.filter((b) => !b.isOutOfRange).length > 0 && (
        <Card className="print:border-none print:shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <FileText className="size-4" />Recent normal biomarkers ({prep.recentBiomarkers.filter((b) => !b.isOutOfRange).length})
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2 text-xs">
              {prep.recentBiomarkers.filter((b) => !b.isOutOfRange).slice(0, 18).map((b) => (
                <div key={b.name} className="flex items-center gap-2 min-w-0">
                  <div className="flex-1 min-w-0 truncate">
                    <span className="font-medium">{b.name}:</span>{" "}
                    <span className="tabular-nums">{b.latest.value} {b.latest.unit ?? ""}</span>
                  </div>
                  <Sparkline
                    points={b.history}
                    referenceLow={b.referenceLow}
                    referenceHigh={b.referenceHigh}
                    width={60}
                    height={18}
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Diet summary */}
      {prep.activeDiet.length > 0 && (
        <Card className="print:border-none print:shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <UtensilsCrossed className="size-4" />Current diet
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="text-xs space-y-0.5">
              {prep.activeDiet.map((d, i) => (
                <li key={i}><span className="text-muted-foreground">{d.time}</span> · {d.items}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Last visit */}
      {prep.lastVisit && (
        <Card className="print:border-none print:shadow-none">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <Stethoscope className="size-4" />Last visit — {prep.lastVisit.date}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-sm">
            {prep.lastVisit.doctorName && <p className="font-medium">Dr. {prep.lastVisit.doctorName}</p>}
            {prep.lastVisit.summary && <p className="text-muted-foreground">{prep.lastVisit.summary}</p>}
          </CardContent>
        </Card>
      )}

      <p className="text-[10px] text-muted-foreground pt-2 border-t print:text-[9px]">
        AI-generated from your uploaded lab reports and records. Intended as a discussion aid — not a diagnosis.
        Please verify all facts with your doctor before acting on them.
      </p>
    </div>
  );
}
