import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { requireApiAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";

const BLOOD_TYPES = ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"] as const;

const BodySchema = z.object({
  dateOfBirth: z.string().nullable().optional(), // ISO date (YYYY-MM-DD)
  bloodType: z.enum([...BLOOD_TYPES, ""]).nullable().optional(),
  allergies: z.array(z.string()).default([]),
  chronicConditions: z.array(z.string()).default([]),
  emergencyContactName: z.string().nullable().optional(),
  emergencyContactPhone: z.string().nullable().optional(),
  emergencyContactRelation: z.string().nullable().optional(),
});

export async function GET() {
  const authResult = await requireApiAuth();
  if (authResult.error) return authResult.error;
  const { userId } = authResult;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      dateOfBirth: true,
      bloodType: true,
      allergies: true,
      chronicConditions: true,
      emergencyContactName: true,
      emergencyContactPhone: true,
      emergencyContactRelation: true,
    },
  });
  return NextResponse.json(user ?? {});
}

export async function POST(req: Request) {
  const authResult = await requireApiAuth();
  if (authResult.error) return authResult.error;
  const { userId } = authResult;

  const body = BodySchema.parse(await req.json());

  await prisma.user.update({
    where: { id: userId },
    data: {
      dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : null,
      bloodType: body.bloodType || null,
      allergies: body.allergies.map((s) => s.trim()).filter(Boolean),
      chronicConditions: body.chronicConditions.map((s) => s.trim()).filter(Boolean),
      emergencyContactName: body.emergencyContactName?.trim() || null,
      emergencyContactPhone: body.emergencyContactPhone?.trim() || null,
      emergencyContactRelation: body.emergencyContactRelation?.trim() || null,
    },
  });

  return NextResponse.json({ ok: true });
}
