import { Info } from "lucide-react";

/**
 * Ayus is an AI-driven personal health record. Everything the product surfaces —
 * lab extraction, insights, chat, and wellness plans — is generated or assisted
 * by AI and must never be mistaken for professional medical advice. This single
 * disclaimer is rendered app-wide (page footer) and in the assistant surfaces so
 * the limitation is always visible, in consistent, professional language.
 *
 *   variant="footer"  → full statement, sits at the bottom of every page
 *   variant="inline"  → one-line notice, sits above chat / generator inputs
 */

const FULL_TEXT =
  "Ayus uses artificial intelligence to extract, organize, and interpret health information — including lab readings, insights, chat responses, and wellness, diet, supplement, and Ayurvedic plans. This is provided for informational and educational purposes only and is not a substitute for professional medical advice, diagnosis, treatment, or independent clinical judgment. AI can be inaccurate or incomplete; always review important details and consult a qualified physician or healthcare provider before making any health decision or acting on this information. In a medical emergency, contact your local emergency services immediately.";

const INLINE_TEXT =
  "Responses are AI-generated and may be inaccurate. This is not medical advice — consult a qualified physician before acting on any information here.";

export function AiDisclaimer({ variant = "footer" }: { variant?: "footer" | "inline" }) {
  if (variant === "inline") {
    return (
      <p
        role="note"
        className="flex items-start gap-1.5 px-1 pt-2 text-[11px] leading-snug text-muted-foreground"
      >
        <Info className="mt-[1px] size-3 shrink-0" aria-hidden />
        <span>{INLINE_TEXT}</span>
      </p>
    );
  }

  return (
    <footer
      role="note"
      aria-label="AI and medical disclaimer"
      className="mt-10 border-t px-2 py-4 print:mt-4"
    >
      <div className="mx-auto flex max-w-4xl items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
        <Info className="mt-[2px] size-3.5 shrink-0" aria-hidden />
        <p>
          <span className="font-medium text-foreground/80">AI &amp; medical disclaimer.</span>{" "}
          {FULL_TEXT}
        </p>
      </div>
    </footer>
  );
}
