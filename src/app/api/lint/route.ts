/**
 * Wiki Health Linter API
 *
 * POST /api/lint
 * Runs AI analysis across the user's health wiki to find:
 * - Contradictions between lab reports
 * - Missing follow-ups
 * - Stale data (no recent tests for tracked biomarkers)
 * - Medication-lab interactions worth noting
 */

import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { getChatProvider } from "@/lib/ai/chat-provider";
import type { ChatMessage } from "@/lib/ai/types";

export async function POST(req: Request) {
  const authResult = await requireApiAuth();
  if (authResult.error) return authResult.error;
  const { userId } = authResult;

  try {
    // Gather context: recent test results, active medications, biomarker entities
    const [recentResults, activeMeds, entities, recentNotes] = await Promise.all([
      prisma.testResult.findMany({
        where: { userId },
        include: { report: { select: { sampleCollectedOn: true } } },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      prisma.medication.findMany({
        where: { userId, active: true },
        select: { name: true, dosage: true, frequency: true, startDate: true },
      }),
      prisma.document.findMany({
        where: { userId, rawContent: { contains: "type: biomarker-entity" } },
        select: { title: true, rawContent: true, updatedAt: true },
        take: 50,
      }),
      prisma.doctorNote.findMany({
        where: { userId },
        include: { prescriptions: true },
        orderBy: { visitDate: "desc" },
        take: 5,
      }),
    ]);

    if (recentResults.length === 0 && entities.length === 0) {
      return NextResponse.json({
        findings: [],
        message: "No health data to lint. Upload lab reports first.",
      });
    }

    // Build context for AI
    let context = "## Recent Test Results\n\n";
    const grouped = new Map<string, typeof recentResults>();
    for (const r of recentResults) {
      if (!grouped.has(r.normalizedName)) grouped.set(r.normalizedName, []);
      grouped.get(r.normalizedName)!.push(r);
    }

    for (const [name, results] of grouped) {
      context += `### ${name}\n`;
      for (const r of results.slice(0, 5)) {
        const date = r.report.sampleCollectedOn?.toISOString().split("T")[0] ?? "unknown";
        context += `- ${date}: ${r.observedValueRaw} ${r.observedValueUnit ?? ""} (ref: ${r.referenceLow ?? "?"}-${r.referenceHigh ?? "?"}) ${r.isOutOfRange ? "⚠️ OUT OF RANGE" : "✓"}\n`;
      }
      context += "\n";
    }

    if (activeMeds.length > 0) {
      context += "## Active Medications\n\n";
      for (const m of activeMeds) {
        context += `- ${m.name} ${m.dosage ?? ""} (${m.frequency}, since ${m.startDate.toISOString().split("T")[0]})\n`;
      }
      context += "\n";
    }

    if (recentNotes.length > 0) {
      context += "## Recent Doctor Visits\n\n";
      for (const n of recentNotes) {
        context += `- ${n.visitDate.toISOString().split("T")[0]}: ${n.doctorName} (${n.specialty})`;
        if (n.diagnosis) context += ` — ${n.diagnosis}`;
        context += "\n";
        for (const rx of n.prescriptions) {
          context += `  - Rx: ${rx.medication} ${rx.dosage ?? ""}\n`;
        }
      }
    }

    // Ask AI to lint
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: `You are a health data analyst reviewing a patient's personal health records for consistency and completeness.

Analyze the data and produce a JSON array of findings. Each finding should have:
- "type": one of "contradiction", "trend_alert", "missing_data", "medication_interaction", "follow_up_needed", "stale_data"
- "severity": "info", "warning", or "critical"
- "title": short title (under 80 chars)
- "description": detailed explanation
- "tests": array of test names involved (if applicable)

Focus on:
1. Contradictions between test results over time
2. Concerning trends (worsening values)
3. Biomarkers that haven't been tested recently (>6 months)
4. Potential medication-lab interactions
5. Missing follow-ups from doctor visits
6. Tests that went from normal to out-of-range

Return ONLY valid JSON array. No markdown, no explanation.`,
      },
      {
        role: "user",
        content: `Here is the patient's health data:\n\n${context}\n\nAnalyze for issues and return JSON array of findings.`,
      },
    ];

    const provider = await getChatProvider();
    const response = await provider.chat(messages, { temperature: 0.3 });

    let findings = [];
    try {
      const cleaned = response.content
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();
      findings = JSON.parse(cleaned);
    } catch {
      findings = [{ type: "error", severity: "info", title: "Lint parse error", description: response.content, tests: [] }];
    }

    return NextResponse.json({ findings });
  } catch (err) {
    console.error("[lint] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lint failed" },
      { status: 500 }
    );
  }
}
