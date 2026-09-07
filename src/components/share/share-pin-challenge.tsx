"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Lock, Loader2 } from "lucide-react";
import { toast } from "sonner";

export function SharePinChallenge({ token }: { token: string }) {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/share/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, pin }),
      });
      if (!res.ok) {
        toast.error("Incorrect PIN.");
        return;
      }
      // Set a cookie so the server-side page can render
      document.cookie = `share_pin_${token}=1; path=/share/${token}; max-age=3600; samesite=lax`;
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <Card className="max-w-md w-full">
        <CardContent className="py-8 space-y-5">
          <div className="text-center space-y-2">
            <div className="mx-auto size-12 rounded-full bg-primary/10 text-primary flex items-center justify-center">
              <Lock className="size-5" />
            </div>
            <h1 className="font-heading text-xl font-semibold">This record is PIN-protected</h1>
            <p className="text-sm text-muted-foreground">
              The patient shared a PIN with you — enter it below to view their record.
            </p>
          </div>
          <form onSubmit={verify} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="pin">PIN</Label>
              <Input
                id="pin"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="••••"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                className="text-center text-xl tracking-widest font-mono"
                autoFocus
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading || pin.length < 4}>
              {loading ? <><Loader2 className="mr-2 size-4 animate-spin" />Verifying…</> : "Unlock"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
