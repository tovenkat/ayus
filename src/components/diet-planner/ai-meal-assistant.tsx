"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Send, Loader2 } from "lucide-react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useDietPrefs } from "@/components/diet-planner/preferences-panel";

const QUICK_QUESTIONS = [
  "What can I eat for lunch that's low-carb?",
  "I'm bored of chapati — what are 3 Indian alternatives?",
  "My HbA1c is creeping up — what breakfast should I switch to?",
  "Give me a 3-day variation of dinner that doesn't repeat.",
  "What fruits are safe for me this week?",
];

export function AiMealAssistant() {
  const { prefs } = useDietPrefs();
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);

  async function ask(q?: string) {
    const text = (q ?? question).trim();
    if (!text || loading) return;
    setLoading(true);
    setAnswer(null);
    setQuestion(text);
    try {
      const res = await fetch("/api/diet/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: text,
          diet: prefs.diet,
          region: prefs.region,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't answer");
        return;
      }
      setAnswer(data.answer);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardContent className="py-5 space-y-4">
        <div className="flex items-center gap-2">
          <div className="size-8 rounded-md bg-primary/10 text-primary flex items-center justify-center">
            <Sparkles className="size-4" />
          </div>
          <div>
            <h2 className="text-base font-semibold">AI meal assistant</h2>
            <p className="text-xs text-muted-foreground">
              Quick Indian-dietician answers grounded in your labs + preferences.
            </p>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask();
          }}
          className="flex gap-2"
        >
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask anything about your diet…"
            disabled={loading}
          />
          <Button type="submit" disabled={loading || !question.trim()}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        </form>

        {!answer && !loading && (
          <div className="flex flex-wrap gap-1.5">
            {QUICK_QUESTIONS.map((q) => (
              <button
                key={q}
                onClick={() => ask(q)}
                className="text-left rounded-full border px-3 py-1 text-xs hover:bg-muted/50 transition"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {loading && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin mx-auto mb-2" />
            Thinking…
          </div>
        )}

        {answer && (
          <div className="rounded-md border bg-muted/20 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px]">Answer</Badge>
              <button
                onClick={() => {
                  setAnswer(null);
                  setQuestion("");
                }}
                className="ml-auto text-xs text-muted-foreground hover:text-foreground"
              >
                Ask another
              </button>
            </div>
            <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer}</ReactMarkdown>
            </div>
            <p className="text-[10px] text-muted-foreground pt-2 border-t">
              Informational only. Discuss major dietary changes with your doctor.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
