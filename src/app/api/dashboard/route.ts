import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiAuth } from "@/lib/auth-helpers";
import { buildDashboardData } from "@/lib/dashboard-queries";

const querySchema = z.object({
  range: z.enum(["30", "90", "365", "all", "custom"]).default("all"),
  from: z.string().optional(),
  to: z.string().optional(),
  category: z.string().optional(),
  abnormalOnly: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  worseningOnly: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export async function GET(request: Request) {
  const authResult = await requireApiAuth();
  if (authResult.error) return authResult.error;
  const { userId } = authResult;

  const { searchParams } = new URL(request.url);
  const raw = Object.fromEntries(searchParams.entries());

  const parsed = querySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = await buildDashboardData(userId, parsed.data);
  return NextResponse.json(data);
}
