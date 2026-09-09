/**
 * Feedback log — everyone sees their own submissions with status; feedback
 * admins (FEEDBACK_EMAIL / FEEDBACK_ADMIN_EMAILS) see all and can triage.
 */

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { isFeedbackAdmin } from "@/lib/email";
import { ACCOUNT_KIND_LABEL, type AccountKind } from "@/lib/account-kind-shared";
import { STATUS_META, FEEDBACK_TYPE_LABEL, FEEDBACK_STATUSES, type FeedbackStatusKey } from "@/lib/feedback-status";
import { FeedbackStatusControl } from "@/components/feedback/feedback-status-control";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Feedback log — Ayus" };

function fmt(d: Date): string {
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default async function FeedbackLogPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const userId = await requireAuth();
  const { status } = await searchParams;
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const admin = isFeedbackAdmin(me?.email);

  const scope = admin ? {} : { userId };
  const activeStatus = FEEDBACK_STATUSES.includes(status as FeedbackStatusKey) ? (status as FeedbackStatusKey) : null;

  const [grouped, items] = await Promise.all([
    prisma.feedback.groupBy({ by: ["status"], where: scope, _count: { _all: true } }),
    prisma.feedback.findMany({
      where: { ...scope, ...(activeStatus ? { status: activeStatus } : {}) },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true, type: true, status: true, subject: true, message: true,
        accountKind: true, createdAt: true, contactEmail: true,
        user: { select: { name: true } },
      },
    }),
  ]);

  const counts = new Map(grouped.map((g) => [g.status, g._count._all]));
  const total = grouped.reduce((n, g) => n + g._count._all, 0);

  const tab = (key: FeedbackStatusKey | null, label: string, count: number) => {
    const href = key ? `/feedback/log?status=${key}` : "/feedback/log";
    const active = activeStatus === key;
    return (
      <Link key={label} href={href}
        className={`rounded-md px-3 py-1 text-sm border transition-colors ${active ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"}`}>
        {label} <span className="tabular-nums opacity-70">{count}</span>
      </Link>
    );
  };

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" nativeButton={false} render={<Link href="/feedback" />}>
        <ArrowLeft className="size-4" /> Back to feedback
      </Button>

      <div>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">Feedback log</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {admin ? "All feedback across accounts — set a status to triage." : "Your submitted feedback and where it stands."}
        </p>
      </div>

      {/* Status filter tabs */}
      <div className="flex flex-wrap gap-1.5">
        {tab(null, "All", total)}
        {FEEDBACK_STATUSES.map((s) => tab(s, STATUS_META[s].label, counts.get(s) ?? 0))}
      </div>

      {items.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
          No feedback{activeStatus ? ` marked ${STATUS_META[activeStatus].label.toLowerCase()}` : " yet"}.
        </CardContent></Card>
      ) : (
        <ul className="space-y-3">
          {items.map((f) => (
            <li key={f.id}>
              <Card>
                <CardContent className="py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="text-[10px]">{FEEDBACK_TYPE_LABEL[f.type] ?? f.type}</Badge>
                        <span className="text-sm font-medium">{f.subject}</span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap line-clamp-4">{f.message}</p>
                      <p className="text-xs text-muted-foreground mt-2">
                        {fmt(f.createdAt)}
                        {admin && <> · {f.user.name ?? "Unknown"} ({ACCOUNT_KIND_LABEL[f.accountKind as AccountKind] ?? f.accountKind})
                          {f.contactEmail && <> · {f.contactEmail}</>}</>}
                      </p>
                    </div>
                    <div className="shrink-0">
                      {admin ? (
                        <FeedbackStatusControl id={f.id} status={f.status} />
                      ) : (
                        <Badge variant="outline" className={STATUS_META[f.status as FeedbackStatusKey].badge}>
                          {STATUS_META[f.status as FeedbackStatusKey].label}
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
