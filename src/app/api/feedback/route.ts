/**
 * POST /api/feedback — in-app feedback from any account kind. Persists the row
 * and emails FEEDBACK_EMAIL (when configured). Never fails the request just
 * because email is unconfigured — the row is the durable record.
 *
 * Body: { type: "FEATURE" | "PROBLEM" | "OTHER"; subject: string; message: string; contactEmail?: string }
 */

import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { getAccountKind, ACCOUNT_KIND_LABEL } from "@/lib/account-kind";
import { sendEmail, feedbackEmailTarget } from "@/lib/email";
import { FeedbackType } from "@prisma/client";

const TYPE_LABEL: Record<string, string> = { FEATURE: "Feature request", PROBLEM: "Problem report", OTHER: "Feedback" };

export async function POST(req: Request) {
  const authResult = await requireApiAuth();
  if (authResult.error) return authResult.error;
  const { userId } = authResult;

  const body = (await req.json().catch(() => ({}))) as {
    type?: string; subject?: string; message?: string; contactEmail?: string;
  };
  const subject = body.subject?.trim();
  const message = body.message?.trim();
  if (!subject || !message) {
    return NextResponse.json({ error: "subject and message are required" }, { status: 400 });
  }
  const type = (Object.values(FeedbackType) as string[]).includes(body.type ?? "")
    ? (body.type as FeedbackType)
    : FeedbackType.OTHER;

  const [kind, user, membership] = await Promise.all([
    getAccountKind(userId),
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true, phone: true } }),
    prisma.organizationMember.findFirst({ where: { userId }, orderBy: { createdAt: "asc" }, select: { organizationId: true, organization: { select: { name: true } } } }),
  ]);

  const cleanEmail = user?.email && !user.email.endsWith("@phone.local") && !user.email.endsWith("@userid.local") ? user.email : null;
  const contactEmail = body.contactEmail?.trim() || cleanEmail;

  const row = await prisma.feedback.create({
    data: {
      userId, organizationId: membership?.organizationId ?? null, accountKind: kind,
      type, subject, message, contactEmail,
    },
    select: { id: true },
  });

  // Email the configured address (best-effort).
  const target = feedbackEmailTarget();
  let emailed = false, demo = false;
  if (target) {
    const who = `${user?.name ?? "A user"} (${ACCOUNT_KIND_LABEL[kind]}${membership?.organization?.name ? ` · ${membership.organization.name}` : ""})`;
    const text = [
      `${TYPE_LABEL[type]} — via Ayus feedback`,
      ``,
      `From:    ${who}`,
      `Contact: ${contactEmail ?? user?.phone ?? "—"}`,
      `Account: ${kind} · user ${userId}`,
      `Type:    ${TYPE_LABEL[type]}`,
      ``,
      `Subject: ${subject}`,
      ``,
      message,
      ``,
      `— feedback id ${row.id}`,
    ].join("\n");
    const result = await sendEmail({ to: target, subject: `[Ayus ${TYPE_LABEL[type]}] ${subject}`, text, replyTo: contactEmail ?? undefined });
    emailed = result.ok && !result.demo;
    demo = !!result.demo;
    if (emailed) await prisma.feedback.update({ where: { id: row.id }, data: { emailedAt: new Date() } });
  }

  return NextResponse.json({ ok: true, id: row.id, emailed, demo, configured: !!target });
}
