"use client";

import { useState } from "react";
import { Loader2, Send, Lightbulb, Bug, MessageSquare } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

type FType = "FEATURE" | "PROBLEM" | "OTHER";
const TYPES: { id: FType; label: string; icon: typeof Lightbulb; hint: string }[] = [
  { id: "FEATURE", label: "Feature idea", icon: Lightbulb, hint: "Something you'd like us to build" },
  { id: "PROBLEM", label: "Problem", icon: Bug, hint: "Something isn't working right" },
  { id: "OTHER", label: "Other", icon: MessageSquare, hint: "Anything else" },
];

export function FeedbackForm({ defaultEmail = "" }: { defaultEmail?: string }) {
  const [type, setType] = useState<FType>("FEATURE");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState(defaultEmail);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit() {
    if (!subject.trim() || !message.trim()) { toast.error("Add a subject and a message"); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, subject, message, contactEmail: email || undefined }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Could not send"); return; }
      setSent(true);
      setSubject(""); setMessage("");
      toast.success(data.emailed ? "Thanks — your feedback was sent to our team." : data.configured ? "Thanks — feedback recorded." : "Thanks — feedback recorded (email not configured).");
    } catch {
      toast.error("Network error");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <Card>
        <CardContent className="py-10 text-center space-y-3">
          <div className="size-12 rounded-full bg-emerald-500/10 text-emerald-600 grid place-items-center mx-auto"><Send className="size-6" /></div>
          <p className="font-medium">Thanks for the feedback!</p>
          <p className="text-sm text-muted-foreground">We read every message. We&apos;ll follow up if we need more detail.</p>
          <Button variant="outline" size="sm" onClick={() => setSent(false)}>Send another</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="py-6 space-y-4">
        <div className="space-y-1.5">
          <Label>What kind of feedback?</Label>
          <div className="grid grid-cols-3 gap-2">
            {TYPES.map((t) => {
              const Icon = t.icon; const active = type === t.id;
              return (
                <button key={t.id} type="button" onClick={() => setType(t.id)}
                  className={`rounded-lg border p-3 text-left transition-colors ${active ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}>
                  <Icon className={`size-4 mb-1 ${active ? "text-primary" : "text-muted-foreground"}`} />
                  <p className="text-sm font-medium">{t.label}</p>
                  <p className="text-[11px] text-muted-foreground leading-tight">{t.hint}</p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="subject">Subject</Label>
          <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="One-line summary" maxLength={140} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="message">Details</Label>
          <Textarea id="message" value={message} onChange={(e) => setMessage(e.target.value)} rows={6}
            placeholder={type === "PROBLEM" ? "What happened, what you expected, and steps to reproduce…" : "Describe your idea or feedback…"} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email">Your email <span className="text-muted-foreground font-normal">(optional — so we can reply)</span></Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="max-w-sm" />
        </div>

        <div className="flex justify-end">
          <Button onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Send feedback
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
