import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { search } from "@/lib/search";
import { getAccountKind, hasPatientRoster } from "@/lib/account-kind";
import { getRosterOrg, getLinkStatusMap } from "@/lib/patient-roster";

export async function GET(req: Request) {
  const authResult = await requireApiAuth();
  if (authResult.error) return authResult.error;
  const { userId } = authResult;

  const url = new URL(req.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20"), 50);

  if (!query) {
    return NextResponse.json({ results: [], tests: [], reports: [], organs: [], patients: [] });
  }

  const entityLimit = Math.min(5, limit);
  const kind = await getAccountKind(userId);
  const rosterKind = hasPatientRoster(kind); // lab / doctor / hospital

  // Patient search — only for non-personal accounts. In Phase A this queries
  // the full User table because Patient / PatientLink don't exist yet; Phase B
  // will narrow this to consented patients on the caller's roster.
  //
  // Match by name, phone, or email fragment. Strips non-digit chars from the
  // query for the phone match so users can search "9000000001" and hit
  // "+910000000001".
  const patientsPromise = rosterKind
    ? prisma.user.findMany({
        where: {
          id: { not: userId }, // don't return yourself
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { email: { contains: query, mode: "insensitive" } },
            ...(query.replace(/\D/g, "").length >= 3
              ? [{ phone: { contains: query.replace(/\D/g, "") } as { contains: string } }]
              : []),
          ],
        },
        select: { id: true, name: true, phone: true, email: true },
        take: entityLimit,
      })
    : Promise.resolve([] as Array<{ id: string; name: string | null; phone: string | null; email: string }>);

  const [results, tests, reports, organs, patients] = await Promise.all([
    search(userId, query, limit),

    prisma.testResult.findMany({
      where: { userId, normalizedName: { contains: query, mode: "insensitive" } },
      select: { normalizedName: true },
      distinct: ["normalizedName"],
      take: entityLimit,
    }),

    prisma.report.findMany({
      where: {
        userId,
        upload: { originalName: { contains: query, mode: "insensitive" } },
      },
      select: {
        id: true,
        sampleCollectedOn: true,
        upload: { select: { originalName: true } },
      },
      orderBy: { createdAt: "desc" },
      take: entityLimit,
    }),

    prisma.organSystem.findMany({
      where: { name: { contains: query, mode: "insensitive" } },
      select: { key: true, name: true },
      take: entityLimit,
    }),

    patientsPromise,
  ]);

  // Annotate each patient hit with this org's consent status, so the UI can
  // show "Open" (granted) vs "Request access" (none/pending/revoked). Search
  // stays global; the gate lives on the dashboard read.
  let linkStatusByPatient = new Map<string, string>();
  if (rosterKind && patients.length > 0) {
    const org = await getRosterOrg(userId);
    if (org) {
      linkStatusByPatient = await getLinkStatusMap(org.orgId, patients.map((p) => p.id));
    }
  }

  return NextResponse.json({
    results,
    tests: tests.map((t) => ({
      name: t.normalizedName,
      href: `/tests/${encodeURIComponent(t.normalizedName)}`,
    })),
    reports: reports.map((r) => ({
      id: r.id,
      name: r.upload.originalName,
      date: r.sampleCollectedOn?.toISOString() ?? null,
      href: `/reports/${r.id}`,
    })),
    organs: organs.map((o) => ({
      key: o.key,
      name: o.name,
      href: `/dashboard/organs#organ-${o.key}`,
    })),
    patients: patients.map((p) => ({
      id: p.id,
      name: p.name ?? "(unnamed)",
      phone: p.phone,
      email: p.email.endsWith("@phone.local") ? null : p.email,
      // "none" until a link row exists; GRANTED means the dashboard opens.
      linkStatus: linkStatusByPatient.get(p.id) ?? "none",
      href: `/patients/${p.id}`,
    })),
  });
}
