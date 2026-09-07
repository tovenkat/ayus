import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { requireApiAuth } from "@/lib/auth-helpers";
import { getProviderForUser } from "@/lib/ai/user-provider";
import { buildHealthSnapshot } from "@/lib/health-snapshot";

const BodySchema = z.object({
  question: z.string().min(1),
  diet: z.enum(["VEGETARIAN", "EGGETARIAN", "NON_VEG", "JAIN", "VEGAN"]).optional(),
  region: z.enum(["SOUTH", "NORTH", "EAST", "WEST", "ANY"]).optional(),
});

export async function POST(req: Request) {
  const authResult = await requireApiAuth();
  if (authResult.error) return authResult.error;
  const { userId } = authResult;

  const body = BodySchema.parse(await req.json());
  const snapshot = await buildHealthSnapshot(userId);

  const system = `You are an Indian-qualified clinical dietician. Answer the user's meal/diet question using their health snapshot and their stated preferences. Keep answers under 200 words. Use Indian cuisine, portion language (katori, roti count). Cite the biomarker when relevant. Never diagnose.

User preferences: diet=${body.diet ?? "VEGETARIAN"}, region=${body.region ?? "ANY"}.

${snapshot}`;

  try {
    const { provider } = await getProviderForUser(userId, "chat");
    const res = await provider.chat(
      [
        { role: "system" as const, content: system },
        { role: "user" as const, content: body.question },
      ],
      { temperature: 0.4, num_ctx: 16384 },
    );
    return NextResponse.json({ answer: res.content.trim() });
  } catch (err) {
    console.error("[diet-assistant]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 },
    );
  }
}
