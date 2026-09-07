import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { requireApiAuth } from "@/lib/auth-helpers";
import { suggestDietPlan } from "@/lib/diet-suggest";

const BodySchema = z.object({
  diet: z.enum(["VEGETARIAN", "EGGETARIAN", "NON_VEG", "JAIN", "VEGAN"]),
  region: z.enum(["SOUTH", "NORTH", "EAST", "WEST", "ANY"]),
  avoid: z.string().optional(),
  goalKcal: z.number().int().nullable().optional(),
});

export async function POST(req: Request) {
  const authResult = await requireApiAuth();
  if (authResult.error) return authResult.error;
  const { userId } = authResult;

  const body = BodySchema.parse(await req.json());

  try {
    const plan = await suggestDietPlan(userId, body);
    return NextResponse.json(plan);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate diet plan";
    console.error("[diet-suggest]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
