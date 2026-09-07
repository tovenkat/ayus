import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { ShareResource } from "@prisma/client";

export type ShareExpiry = "24H" | "48H" | "7D" | "30D";

function expiryToDate(v: ShareExpiry): Date {
  const ms: Record<ShareExpiry, number> = {
    "24H": 24 * 60 * 60 * 1000,
    "48H": 48 * 60 * 60 * 1000,
    "7D": 7 * 24 * 60 * 60 * 1000,
    "30D": 30 * 24 * 60 * 60 * 1000,
  };
  return new Date(Date.now() + ms[v]);
}

function makeToken(): string {
  // 24 chars, URL-safe
  return crypto.randomBytes(18).toString("base64url");
}

function hashPin(pin: string, salt: string): string {
  return crypto.createHash("sha256").update(`${salt}|${pin}`).digest("hex");
}

export type CreateShareInput = {
  userId: string;
  resource: ShareResource;
  resourceId?: string | null;
  snapshotJson?: unknown;
  pin?: string;
  recipientName?: string;
  recipientPhone?: string;
  expiry?: ShareExpiry;
  maxViews?: number;
};

export async function createShareLink(input: CreateShareInput): Promise<{
  token: string;
  url: string;
  expiresAt: Date;
}> {
  const token = makeToken();
  const expiresAt = expiryToDate(input.expiry ?? "48H");
  const pinHash = input.pin && input.pin.length >= 4
    ? hashPin(input.pin, token)
    : null;

  const host = process.env.NEXTAUTH_URL ?? process.env.APP_URL ?? "http://localhost:3001";

  await prisma.shareLink.create({
    data: {
      token,
      userId: input.userId,
      resource: input.resource,
      resourceId: input.resourceId ?? null,
      snapshotJson: input.snapshotJson ? JSON.parse(JSON.stringify(input.snapshotJson)) : undefined,
      pinHash,
      recipientName: input.recipientName?.trim() || null,
      recipientPhone: input.recipientPhone?.trim() || null,
      expiresAt,
      maxViews: input.maxViews ?? null,
    },
  });

  return {
    token,
    url: `${host.replace(/\/$/, "")}/share/${token}`,
    expiresAt,
  };
}

export type ShareLookupResult =
  | { ok: true; link: { id: string; userId: string; resource: ShareResource; resourceId: string | null; snapshotJson: unknown; requiresPin: boolean } }
  | { ok: false; reason: "not_found" | "expired" | "revoked" | "view_limit" };

export async function lookupShareLink(token: string): Promise<ShareLookupResult> {
  const link = await prisma.shareLink.findUnique({ where: { token } });
  if (!link) return { ok: false, reason: "not_found" };
  if (link.revokedAt) return { ok: false, reason: "revoked" };
  if (link.expiresAt < new Date()) return { ok: false, reason: "expired" };
  if (link.maxViews !== null && link.viewCount >= link.maxViews) return { ok: false, reason: "view_limit" };
  return {
    ok: true,
    link: {
      id: link.id,
      userId: link.userId,
      resource: link.resource,
      resourceId: link.resourceId,
      snapshotJson: link.snapshotJson,
      requiresPin: !!link.pinHash,
    },
  };
}

export async function verifySharePin(token: string, pin: string): Promise<boolean> {
  const link = await prisma.shareLink.findUnique({
    where: { token },
    select: { pinHash: true },
  });
  if (!link?.pinHash) return false;
  return hashPin(pin.trim(), token) === link.pinHash;
}

export async function recordShareView(token: string): Promise<void> {
  await prisma.shareLink.update({
    where: { token },
    data: {
      viewCount: { increment: 1 },
      lastViewedAt: new Date(),
    },
  }).catch(() => {});
}

export async function revokeShareLink(userId: string, token: string): Promise<boolean> {
  const res = await prisma.shareLink.updateMany({
    where: { token, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return res.count > 0;
}

export function formatShareMessage(
  resource: ShareResource,
  patientName: string,
  url: string,
  expiresAt: Date,
  pin?: string,
): string {
  const resourceLabel: Record<ShareResource, string> = {
    EMERGENCY_CARD: "Emergency Medical Card",
    VISIT_PREP: "Doctor Visit Prep summary",
    REPORT: "Lab Report",
    FULL_WIKI: "Full health record",
    DOCTOR_NOTE: "Doctor visit record",
  };
  const exp = expiresAt.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const lines = [
    `*${patientName}* has shared their ${resourceLabel[resource]} with you via *Ayus*.`,
    "",
    `🔗 ${url}`,
  ];
  if (pin) lines.push(`🔐 PIN: ${pin}`);
  lines.push("", `⏱ Link expires ${exp}.`, "", "_This is a read-only view. No account needed._");
  return lines.join("\n");
}
