"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { UserRound, Loader2 } from "lucide-react";
import { toast } from "sonner";

export function NameCaptureCard() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Please enter your name.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/user/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Couldn't save" }));
        toast.error(error ?? "Couldn't save");
        return;
      }
      toast.success(`Welcome, ${trimmed.split(" ")[0]}!`);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="py-4 flex items-start gap-3">
        <div className="size-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <UserRound className="size-5" />
        </div>
        <form onSubmit={save} className="flex-1 space-y-2">
          <div>
            <Label htmlFor="name-capture" className="font-medium text-sm">
              What should we call you?
            </Label>
            <p className="text-xs text-muted-foreground">
              Your health record works better when it knows who it's for.
            </p>
          </div>
          <div className="flex gap-2">
            <Input
              id="name-capture"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Venkat"
              autoComplete="name"
              maxLength={80}
              disabled={saving}
            />
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : "Save"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
