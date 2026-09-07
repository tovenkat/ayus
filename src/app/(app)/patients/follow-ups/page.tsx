/**
 * Follow-up / due-for-repeat drill-down — laboratory decision-support.
 *
 *   /patients/follow-ups                 → Health Action Center (counts by test)
 *   /patients/follow-ups?test=HbA1c      → patients due for that test
 *   /patients/follow-ups?view=missed     → long-overdue patients across tests
 *
 * All recommendations are guideline-based decision support, not diagnoses.
 */

import Link from "next/link";
import { ArrowLeft, ArrowRight, Repeat } from "lucide-react";
import { requireAuth } from "@/lib/auth-helpers";
import { requireKind } from "@/lib/account-kind";
import { getRosterOrg } from "@/lib/patient-roster";
import {
  getFollowUpActionCounts, getFollowUpPatients, getMissedFollowUps, type FollowUpItem,
} from "@/lib/lab-population";
import { REPEAT_INTERVAL_BY_NAME } from "@/lib/repeat-intervals";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function StatusCell({ item }: { item: FollowUpItem }) {
  const overdue = item.monthsOverdue <= 0 ? "Due now" : `${item.monthsOverdue} mo overdue`;
  const cls = item.status === "missed"
    ? "text-red-600 border-red-500/30 bg-red-500/10"
    : "text-amber-600 border-amber-500/30 bg-amber-500/10";
  return <Badge variant="outline" className={cls}>{item.status === "missed" ? "Missed · " : "Due · "}{overdue}</Badge>;
}

function PatientTable({ items }: { items: FollowUpItem[] }) {
  return (
    <Card>
      <CardContent className="px-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Patient</TableHead>
                <TableHead>Previous</TableHead>
                <TableHead>Last test</TableHead>
                <TableHead>Recommendation</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((it) => (
                <TableRow key={`${it.patientId}-${it.canonicalName}`}>
                  <TableCell className="font-medium">{it.patientName}</TableCell>
                  <TableCell className="tabular-nums">{it.previousValue}</TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap">{fmtDate(it.lastTest)}</TableCell>
                  <TableCell className="text-muted-foreground">{it.recommendation}</TableCell>
                  <TableCell><StatusCell item={it} /></TableCell>
                  <TableCell>
                    <Link href={`/patients/${it.patientId}`} className="text-primary inline-flex items-center gap-1 text-sm hover:underline">
                      Open <ArrowRight className="size-3.5" />
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function Disclaimer({ guideline }: { guideline?: string }) {
  return (
    <p className="text-[11px] text-muted-foreground">
      {guideline && <>Interval basis: {guideline}. </>}
      Guideline-based decision support — not a diagnosis. Final decisions rest with the treating clinician.
    </p>
  );
}

export default async function FollowUpsPage({
  searchParams,
}: {
  searchParams: Promise<{ test?: string; view?: string }>;
}) {
  const userId = await requireAuth();
  await requireKind("lab", "doctor", "hospital");
  const org = await getRosterOrg(userId);
  const { test, view } = await searchParams;

  const back = (
    <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" nativeButton={false} render={<Link href="/dashboard" />}>
      <ArrowLeft className="size-4" /> Back to dashboard
    </Button>
  );

  if (!org) {
    return <div className="max-w-4xl mx-auto space-y-4">{back}<p className="text-sm text-muted-foreground">No organization found.</p></div>;
  }

  // ── Per-test drill-down ──────────────────────────────────────────────────
  if (test) {
    const entry = REPEAT_INTERVAL_BY_NAME[test];
    const items = await getFollowUpPatients(org.orgId, test);
    return (
      <div className="max-w-4xl mx-auto space-y-4">
        {back}
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">{entry?.action ?? test}</h1>
          <p className="text-sm text-muted-foreground">{items.length} consented patient{items.length !== 1 ? "s" : ""} due for repeat testing.</p>
        </div>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No patients are currently due for this test.</p>
        ) : (
          <>
            <PatientTable items={items} />
            <Disclaimer guideline={entry?.guideline} />
          </>
        )}
      </div>
    );
  }

  // ── Missed follow-ups across all tests ───────────────────────────────────
  if (view === "missed") {
    const items = await getMissedFollowUps(org.orgId, 100);
    return (
      <div className="max-w-4xl mx-auto space-y-4">
        {back}
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Missed follow-ups</h1>
          <p className="text-sm text-muted-foreground">
            Consented patients overdue by more than a full recall interval — candidates for a reminder.
          </p>
        </div>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No missed follow-ups. Nice continuity of care.</p>
        ) : (
          <>
            <PatientTable items={items} />
            <Disclaimer />
          </>
        )}
      </div>
    );
  }

  // ── Health Action Center overview ────────────────────────────────────────
  const actions = await getFollowUpActionCounts(org.orgId);
  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {back}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Repeat className="size-5" /> Health Action Center
          </h1>
          <p className="text-sm text-muted-foreground">Evidence-based repeat-testing recall across your consented roster.</p>
        </div>
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/patients/follow-ups?view=missed" />}>
          View missed
        </Button>
      </div>
      {actions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No patients due for repeat testing yet.</p>
      ) : (
        <Card>
          <CardContent className="px-0">
            <ul className="divide-y">
              {actions.map((a) => (
                <li key={a.canonicalName}>
                  <Link
                    href={`/patients/follow-ups?test=${encodeURIComponent(a.canonicalName)}`}
                    className="flex items-center justify-between gap-3 py-3 px-4 hover:bg-muted/50 transition-colors"
                  >
                    <span className="text-sm font-medium">{a.action}</span>
                    <span className="flex items-center gap-2">
                      <Badge variant="outline" className="tabular-nums">{a.count}</Badge>
                      <ArrowRight className="size-3.5 text-muted-foreground" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <Disclaimer />
    </div>
  );
}
