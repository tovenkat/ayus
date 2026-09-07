import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { verifySharePin } from "@/lib/share";

const BodySchema = z.object({
  token: z.string(),
  pin: z.string(),
});

export async function POST(req: Request) {
  const body = BodySchema.parse(await req.json());
  const ok = await verifySharePin(body.token, body.pin);
  if (!ok) return NextResponse.json({ ok: false }, { status: 403 });
  return NextResponse.json({ ok: true });
}
