"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Loader2, FileText, Sparkles, Heart, TrendingUp, Pill, UtensilsCrossed, Stethoscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { AiDisclaimer } from "@/components/ui/ai-disclaimer";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const SUGGESTED_PROMPTS = [
  { icon: TrendingUp, text: "How has my HbA1c trended over the last year?" },
  { icon: Stethoscope, text: "What did my last doctor visit focus on?" },
  { icon: Pill, text: "Summarize the medications I'm currently on and why." },
  { icon: UtensilsCrossed, text: "Given my latest labs, what should I avoid eating this week?" },
  { icon: FileText, text: "Which of my biomarkers are out of range right now?" },
  { icon: Sparkles, text: "What questions should I ask my doctor at my next visit?" },
];

type Message = {
  role: "user" | "assistant";
  content: string;
  citations?: { documentId: string; slug: string; title: string }[];
};

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [healthMode, setHealthMode] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, sessionId, healthMode }),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(errBody.error ?? "Chat request failed");
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let assistantContent = "";
      let citations: Message["citations"] = [];
      let buffer = "";
      let streamError: string | null = null;

      // Add empty assistant message to stream into
      setMessages((prev) => [...prev, { role: "assistant", content: "", citations: [] }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        // Keep the last (possibly partial) line in the buffer
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          let event: { type: string; [k: string]: unknown };
          try {
            event = JSON.parse(line);
          } catch {
            continue; // skip malformed NDJSON lines
          }
          if (event.type === "session") {
            setSessionId(event.sessionId as string);
          } else if (event.type === "citations") {
            citations = event.citations as Message["citations"];
          } else if (event.type === "token") {
            assistantContent += (event.content as string) ?? "";
            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = {
                role: "assistant",
                content: assistantContent,
                citations,
              };
              return updated;
            });
          } else if (event.type === "error") {
            streamError = (event.error as string) ?? "Stream error";
          }
        }
      }

      // Flush trailing buffer
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer);
          if (event.type === "token") assistantContent += event.content;
          if (event.type === "error") streamError = event.error ?? "Stream error";
        } catch {}
      }

      if (streamError) throw new Error(streamError);
      if (!assistantContent.trim()) throw new Error("Empty response from the model.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong. Please try again.";
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        // Replace the empty assistant bubble if we added one and got nothing back
        if (last?.role === "assistant" && !last.content) {
          return [...prev.slice(0, -1), { role: "assistant", content: `⚠️ ${msg}` }];
        }
        return [...prev, { role: "assistant", content: `⚠️ ${msg}` }];
      });
    } finally {
      setLoading(false);
    }
  }, [input, loading, sessionId, healthMode]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)] max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between pb-4">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">Chat</h1>
        <div className="flex items-center gap-2">
          <Label htmlFor="health-mode" className="text-xs text-muted-foreground flex items-center gap-1">
            <Heart className="size-3" />
            Health mode
          </Label>
          <Switch
            id="health-mode"
            checked={healthMode}
            onCheckedChange={setHealthMode}
          />
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-4 pb-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full py-8 px-4 text-center space-y-6">
            <div className="space-y-2">
              <div className="mx-auto size-14 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                <Sparkles className="size-6" />
              </div>
              <p className="font-heading text-xl font-semibold">Ask your health record</p>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Your latest biomarkers, medications, diet schedule, and wiki pages are used as context.
                Try one of these, or type your own.
              </p>
            </div>
            <div className="grid sm:grid-cols-2 gap-2 w-full max-w-xl">
              {SUGGESTED_PROMPTS.map((p) => (
                <button
                  key={p.text}
                  type="button"
                  onClick={() => {
                    setInput(p.text);
                    setTimeout(() => {
                      const btn = document.querySelector<HTMLButtonElement>('[data-send-btn="1"]');
                      btn?.click();
                    }, 0);
                  }}
                  className="text-left rounded-md border p-3 hover:bg-muted/50 transition flex items-start gap-2"
                >
                  <p.icon className="size-4 text-primary shrink-0 mt-0.5" />
                  <span className="text-sm">{p.text}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-lg px-4 py-3 text-sm ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted"
              }`}
            >
              {msg.role === "assistant" ? (
                <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {msg.content || "..."}
                  </ReactMarkdown>
                </div>
              ) : (
                <p className="whitespace-pre-wrap">{msg.content}</p>
              )}

              {/* Citations */}
              {msg.citations && msg.citations.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2 pt-2 border-t border-border/50">
                  {Array.from(
                    new Map(msg.citations.map((c) => [c.documentId, c])).values(),
                  ).map((cite) => (
                    <Link key={cite.documentId} href={`/wiki/${cite.slug}`}>
                      <Badge
                        variant="outline"
                        className="text-[10px] cursor-pointer hover:bg-background/50"
                      >
                        <FileText className="size-2.5 mr-1" />
                        {cite.title}
                      </Badge>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && messages[messages.length - 1]?.role === "user" && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-lg px-4 py-3">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <Card className="shrink-0">
        <CardContent className="p-3">
          <div className="flex gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your health records..."
              className="min-h-11 max-h-32 resize-none"
              rows={1}
            />
            <Button
              onClick={sendMessage}
              disabled={loading || !input.trim()}
              size="icon"
              className="shrink-0 self-end"
              data-send-btn="1"
            >
              <Send className="size-4" />
            </Button>
          </div>
          <AiDisclaimer variant="inline" />
        </CardContent>
      </Card>
    </div>
  );
}
