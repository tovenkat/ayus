/**
 * Chat API — streaming RAG chat with document context.
 */

import { NextResponse } from "next/server";
import { requireApiAuth } from "@/lib/auth-helpers";
import { checkApiRateLimit } from "@/lib/rate-limit";
import { getProviderForUser } from "@/lib/ai/user-provider";
import { retrieveContext } from "@/lib/rag";
import { buildHealthSnapshot } from "@/lib/health-snapshot";
import { prisma } from "@/lib/prisma";
import { getAccountKind, type AccountKind } from "@/lib/account-kind";
import type { ChatMessage } from "@/lib/ai/types";

const DEFAULT_SYSTEM_PROMPT = `You are a helpful knowledge assistant. You answer questions using the provided document context from the user's personal wiki.

RULES:
1. Answer based on the provided context. If the context doesn't contain relevant information, say so.
2. When citing information, mention which document it comes from (e.g., "According to your note 'Document Title'...").
3. Be concise and direct.
4. If asked about connections between topics, look for relationships across the provided documents.
5. Maintain the user's terminology and style.`;

const HEALTH_SYSTEM_PROMPT = `You are the user's personal health assistant. You have direct access to their current biomarkers, active medications, diet schedule, and last doctor visit through the <health_snapshot> block provided below. You also receive relevant document chunks from their wiki for deeper context.

RULES:
1. Prefer the structured <health_snapshot> for facts about current state (latest readings, meds). Use the wiki chunks for narrative context, history, and any facts not in the snapshot.
2. Cite wiki documents when you reference them. You do not need to cite the snapshot — it's live DB state.
3. Understand Indian lab formats (Thyrocare, SRL, Apollo, Dr Lal), common medical abbreviations, and Indian reference ranges.
4. If asked about trends (e.g., "how has my HbA1c been?"), answer with actual dates and values from the snapshot or wiki, not guesses.
5. If you notice concerning values or interactions, flag them clearly — but never diagnose. Always recommend discussing with their doctor.
6. If a question is outside the record (e.g., "what should I eat tonight?"), you can give general guidance informed by their biomarkers, but remind them it's a discussion aid, not medical advice.
7. Be concise and direct. Use bullet points for lists.`;

const LAB_SYSTEM_PROMPT = `You assist staff at a diagnostic lab. The user works at a lab/diagnostic center; they upload reports for many different patients.

You may receive wiki chunks belonging to YOUR lab's organization (uploads they have ingested), not random patient data.

RULES:
1. Treat patient details as PHI. When the user asks about a specific patient, confirm you've located them by phone or ID before sharing anything.
2. Help with operational tasks: identifying which patient a report belongs to (by name/phone/DOB on the report), spotting upload errors (wrong patient attached, duplicate uploads, missing pages), and summarizing what a report contains so the lab can label it correctly.
3. Do NOT provide clinical interpretation, diagnoses, or treatment guidance — that is the doctor's role, not the lab's. If asked, redirect: "this needs the patient's clinician."
4. Be concise. Lab staff want short answers, not explanations.`;

const DOCTOR_SYSTEM_PROMPT = `You assist a clinician reviewing their patients' records.

You may receive wiki chunks belonging to patients who have explicitly shared their records with this clinic. In this version of the app there is no cross-patient sharing yet, so the chunks will usually be from the clinic's own notes/uploads only.

RULES:
1. Help with clinical reasoning: trend analysis across visits, medication review for interactions, flagging out-of-range values, comparing current results to prior baselines.
2. Be specific with dates and values — cite the source document for every numeric claim. If a value isn't in the provided context, say so rather than estimating.
3. Stay within decision-support: surface findings, suggest considerations, flag risks. Do not autonomously prescribe; the clinician is the decision-maker.
4. Understand Indian lab formats (Thyrocare, SRL, Apollo, Dr Lal), abbreviations, and ranges.
5. Be concise; clinicians read fast.`;

function systemPromptFor(kind: AccountKind, healthMode: boolean): string {
  switch (kind) {
    case "lab":
      return LAB_SYSTEM_PROMPT;
    case "doctor":
      return DOCTOR_SYSTEM_PROMPT;
    case "personal":
      return healthMode ? HEALTH_SYSTEM_PROMPT : DEFAULT_SYSTEM_PROMPT;
    case "unknown":
    default:
      return healthMode ? HEALTH_SYSTEM_PROMPT : DEFAULT_SYSTEM_PROMPT;
  }
}

export async function POST(req: Request) {
  const authResult = await requireApiAuth();
  if (authResult.error) return authResult.error;
  const { userId } = authResult;

  const rateLimit = checkApiRateLimit(userId, 20, 0.33);
  if (rateLimit) return rateLimit;

  try {
    const body = await req.json();
    const { message, sessionId, healthMode } = body as {
      message: string;
      sessionId?: string;
      healthMode?: boolean;
    };

    if (!message?.trim()) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    // ── Get or create session ─────────────────────────────────────────────
    let session;
    if (sessionId) {
      session = await prisma.chatSession.findFirst({
        where: { id: sessionId, userId },
        include: { messages: { orderBy: { createdAt: "asc" }, take: 20 } },
      });
    }

    if (!session) {
      session = await prisma.chatSession.create({
        data: {
          userId,
          title: message.slice(0, 100),
        },
        include: { messages: true },
      });
    }

    // ── Save user message ─────────────────────────────────────────────────
    await prisma.chatMessage.create({
      data: { sessionId: session.id, role: "USER", content: message },
    });

    // ── Resolve account kind so the agent adapts (personal / lab / doctor) ─
    const accountKind = await getAccountKind(userId);

    // Health snapshot is only meaningful for the patient themselves.
    const wantSnapshot = healthMode && accountKind === "personal";

    // ── Retrieve context (RAG chunks + optional structured snapshot) ──────
    const [context, snapshot] = await Promise.all([
      retrieveContext(userId, message),
      wantSnapshot ? buildHealthSnapshot(userId) : Promise.resolve(""),
    ]);

    // ── Build messages ────────────────────────────────────────────────────
    const systemPrompt = systemPromptFor(accountKind, !!healthMode);
    console.log(`[chat] user=${userId} kind=${accountKind} snapshot=${!!snapshot}`);

    const contextBlock = context.contextText
      ? `\n\nHere are relevant chunks from the user's wiki:\n\n${context.contextText}`
      : "\n\nNo matching wiki chunks were retrieved for this query.";

    const snapshotBlock = snapshot ? `\n\n${snapshot}` : "";

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt + snapshotBlock + contextBlock },
    ];

    // Add conversation history
    for (const msg of session.messages.slice(-10)) {
      messages.push({
        role: msg.role === "USER" ? "user" : "assistant",
        content: msg.content,
      });
    }

    messages.push({ role: "user", content: message });

    // ── Stream response ─────────────────────────────────────────────────
    const { provider } = await getProviderForUser(userId, "chat");
    const stream = provider.chatStream(messages, { temperature: 0.3 });

    const encoder = new TextEncoder();
    let fullResponse = "";

    const readable = new ReadableStream({
      async start(controller) {
        try {
          // Send session ID first
          controller.enqueue(
            encoder.encode(JSON.stringify({ type: "session", sessionId: session.id }) + "\n")
          );

          // Send citations (deduped — RAG often returns multiple chunks per doc)
          const seenDocs = new Set<string>();
          const uniqueCitations = context.chunks.flatMap((c) => {
            if (seenDocs.has(c.documentId)) return [];
            seenDocs.add(c.documentId);
            return [{ documentId: c.documentId, slug: c.slug, title: c.title }];
          });
          if (uniqueCitations.length > 0) {
            controller.enqueue(
              encoder.encode(
                JSON.stringify({ type: "citations", citations: uniqueCitations }) + "\n"
              )
            );
          }

          for await (const token of stream) {
            fullResponse += token;
            controller.enqueue(
              encoder.encode(JSON.stringify({ type: "token", content: token }) + "\n")
            );
          }

          // Save assistant message
          await prisma.chatMessage.create({
            data: {
              sessionId: session.id,
              role: "ASSISTANT",
              content: fullResponse,
              citations: uniqueCitations.length > 0
                ? uniqueCitations
                : undefined,
            },
          });

          controller.enqueue(
            encoder.encode(JSON.stringify({ type: "done" }) + "\n")
          );
          controller.close();
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Stream error";
          controller.enqueue(
            encoder.encode(JSON.stringify({ type: "error", error: msg }) + "\n")
          );
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    console.error("[chat] Error:", err);
    return NextResponse.json(
      { error: "Chat failed" },
      { status: 500 }
    );
  }
}
