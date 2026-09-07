"use server";

import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/auth-helpers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { Specialty, MedFrequency, MealType } from "@prisma/client";

// ─── Doctor Notes ───────────────────────────────────────────────────────────

export type DoctorNoteState = {
  errors?: Record<string, string[]>;
  message?: string;
  success?: boolean;
};

export async function createDoctorNote(
  _prev: DoctorNoteState,
  formData: FormData
): Promise<DoctorNoteState> {
  const userId = await requireAuth();

  const visitDate = formData.get("visitDate") as string;
  const doctorName = (formData.get("doctorName") as string)?.trim();
  const specialty = formData.get("specialty") as Specialty;
  const clinic = (formData.get("clinic") as string)?.trim() || null;
  const diagnosis = (formData.get("diagnosis") as string)?.trim() || null;
  const notes = (formData.get("notes") as string)?.trim() || null;
  const followUpDate = (formData.get("followUpDate") as string) || null;

  // Prescriptions from dynamic form fields
  const medNames = formData.getAll("medName") as string[];
  const medDosages = formData.getAll("medDosage") as string[];
  const medFrequencies = formData.getAll("medFrequency") as string[];
  const medDurations = formData.getAll("medDuration") as string[];
  const medInstructions = formData.getAll("medInstructions") as string[];

  if (!visitDate || !doctorName) {
    return { errors: { doctorName: ["Visit date and doctor name are required"] } };
  }

  const prescriptions = medNames
    .map((name, i) => ({
      medication: name.trim(),
      dosage: medDosages[i]?.trim() || null,
      frequency: medFrequencies[i]?.trim() || null,
      duration: medDurations[i]?.trim() || null,
      instructions: medInstructions[i]?.trim() || null,
    }))
    .filter((p) => p.medication);

  await prisma.doctorNote.create({
    data: {
      userId,
      visitDate: new Date(visitDate),
      doctorName,
      specialty,
      clinic,
      diagnosis,
      notes,
      followUpDate: followUpDate ? new Date(followUpDate) : null,
      prescriptions: {
        create: prescriptions,
      },
    },
  });

  revalidatePath("/doctor-notes");
  revalidatePath("/dashboard");
  redirect("/doctor-notes");
}

export async function deleteDoctorNote(id: string): Promise<void> {
  const userId = await requireAuth();
  await prisma.doctorNote.deleteMany({ where: { id, userId } });
  revalidatePath("/doctor-notes");
  revalidatePath("/dashboard");
}

// ─── Medications ────────────────────────────────────────────────────────────

export type MedicationState = {
  errors?: Record<string, string[]>;
  success?: boolean;
};

export async function createMedication(
  _prev: MedicationState,
  formData: FormData
): Promise<MedicationState> {
  const userId = await requireAuth();

  const name = (formData.get("name") as string)?.trim();
  const dosage = (formData.get("dosage") as string)?.trim() || null;
  const frequency = formData.get("frequency") as MedFrequency;
  const timeSlots = formData.getAll("timeSlots") as string[];
  const startDate = formData.get("startDate") as string;
  const endDate = (formData.get("endDate") as string) || null;
  const notes = (formData.get("notes") as string)?.trim() || null;

  if (!name) {
    return { errors: { name: ["Medication name is required"] } };
  }

  await prisma.medication.create({
    data: {
      userId,
      name,
      dosage,
      frequency,
      timeSlots,
      startDate: startDate ? new Date(startDate) : new Date(),
      endDate: endDate ? new Date(endDate) : null,
      notes,
    },
  });

  revalidatePath("/medications");
  revalidatePath("/dashboard");
  return { success: true };
}

export async function toggleMedication(id: string, active: boolean): Promise<void> {
  const userId = await requireAuth();
  await prisma.medication.updateMany({
    where: { id, userId },
    data: { active },
  });
  revalidatePath("/medications");
  revalidatePath("/dashboard");
}

export async function deleteMedication(id: string): Promise<void> {
  const userId = await requireAuth();
  await prisma.medication.deleteMany({ where: { id, userId } });
  revalidatePath("/medications");
  revalidatePath("/dashboard");
}

// ─── Diet Schedule ──────────────────────────────────────────────────────────

export type DietState = {
  errors?: Record<string, string[]>;
  success?: boolean;
};

export async function createDietSchedule(
  _prev: DietState,
  formData: FormData
): Promise<DietState> {
  const userId = await requireAuth();

  const mealType = formData.get("mealType") as MealType;
  const time = (formData.get("time") as string) || "08:00";
  const items = (formData.get("items") as string)?.trim();
  const calories = parseInt(formData.get("calories") as string) || null;
  const notes = (formData.get("notes") as string)?.trim() || null;
  const restrictions = formData.getAll("restrictions") as string[];
  const daysOfWeek = formData.getAll("daysOfWeek").map(Number);

  if (!items) {
    return { errors: { items: ["Meal items are required"] } };
  }

  await prisma.dietSchedule.create({
    data: {
      userId,
      mealType,
      time,
      items,
      calories,
      notes,
      restrictions,
      daysOfWeek,
    },
  });

  revalidatePath("/diet");
  revalidatePath("/dashboard");
  return { success: true };
}

export async function toggleDietSchedule(id: string, active: boolean): Promise<void> {
  const userId = await requireAuth();
  await prisma.dietSchedule.updateMany({
    where: { id, userId },
    data: { active },
  });
  revalidatePath("/diet");
  revalidatePath("/dashboard");
}

export async function deleteDietSchedule(id: string): Promise<void> {
  const userId = await requireAuth();
  await prisma.dietSchedule.deleteMany({ where: { id, userId } });
  revalidatePath("/diet");
  revalidatePath("/dashboard");
}

/** Lock a meal so "Surprise Me" / regenerate skips it. */
export async function toggleMealLock(id: string, locked: boolean): Promise<void> {
  const userId = await requireAuth();
  await prisma.dietSchedule.updateMany({ where: { id, userId }, data: { locked } });
  revalidatePath("/diet");
}

/** Star a meal — sort-first + AI hint to suggest similar. */
export async function toggleMealFavorite(id: string, isFavorite: boolean): Promise<void> {
  const userId = await requireAuth();
  await prisma.dietSchedule.updateMany({ where: { id, userId }, data: { isFavorite } });
  revalidatePath("/diet");
}

/** Hide a meal — soft-delete (undo-able), removes from planner without losing history. */
export async function toggleMealHidden(id: string, hidden: boolean): Promise<void> {
  const userId = await requireAuth();
  await prisma.dietSchedule.updateMany({ where: { id, userId }, data: { hidden } });
  revalidatePath("/diet");
  revalidatePath("/dashboard");
}

export async function acceptDietSuggestion(input: {
  mealType: MealType;
  time: string;
  items: string;
  calories: number | null;
  restrictions: string[];
  notes: string | null;
  mode?: "ADD" | "REPLACE"; // REPLACE deactivates existing meals of the same type
}): Promise<{ ok: true; id: string; replacedIds: string[] }> {
  const userId = await requireAuth();

  let replacedIds: string[] = [];
  if (input.mode === "REPLACE") {
    const existing = await prisma.dietSchedule.findMany({
      where: { userId, mealType: input.mealType, active: true },
      select: { id: true },
    });
    replacedIds = existing.map((e) => e.id);
    if (replacedIds.length > 0) {
      await prisma.dietSchedule.updateMany({
        where: { id: { in: replacedIds } },
        data: { active: false },
      });
    }
  }

  const created = await prisma.dietSchedule.create({
    data: {
      userId,
      mealType: input.mealType,
      time: input.time,
      items: input.items,
      calories: input.calories,
      notes: input.notes,
      restrictions: input.restrictions,
      daysOfWeek: [],
    },
  });
  revalidatePath("/diet");
  revalidatePath("/dashboard");
  return { ok: true, id: created.id, replacedIds };
}
