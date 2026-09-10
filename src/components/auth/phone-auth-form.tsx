"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/ui/logo";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Phone, KeyRound, ArrowLeft, Info } from "lucide-react";
import { requestOtpAction, type OtpRequestState } from "@/lib/actions/auth";

type Props = { mode: "LOGIN" | "REGISTER" };

// Country dial codes for the picker. India first (primary market); a short
// common-market list keeps the dropdown usable. Add rows as needed.
const COUNTRIES: { code: string; dial: string; flag: string; label: string }[] = [
  { code: "IN", dial: "+91", flag: "🇮🇳", label: "India" },
  { code: "US", dial: "+1", flag: "🇺🇸", label: "United States" },
  { code: "GB", dial: "+44", flag: "🇬🇧", label: "United Kingdom" },
  { code: "AE", dial: "+971", flag: "🇦🇪", label: "UAE" },
  { code: "SG", dial: "+65", flag: "🇸🇬", label: "Singapore" },
  { code: "AU", dial: "+61", flag: "🇦🇺", label: "Australia" },
  { code: "CA", dial: "+1", flag: "🇨🇦", label: "Canada" },
  { code: "SA", dial: "+966", flag: "🇸🇦", label: "Saudi Arabia" },
  { code: "MY", dial: "+60", flag: "🇲🇾", label: "Malaysia" },
  { code: "DE", dial: "+49", flag: "🇩🇪", label: "Germany" },
];

export function PhoneAuthForm({ mode }: Props) {
  const router = useRouter();

  const [name, setName] = useState("");
  const [dialCode, setDialCode] = useState("+91"); // default India
  const [phone, setPhone] = useState(""); // national number only (digits)
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [reqState, reqAction, reqPending] = useActionState<OtpRequestState, FormData>(
    requestOtpAction,
    {},
  );

  // Pre-fill the OTP in demo mode so the reviewer can just click Verify
  useEffect(() => {
    if (reqState.devCode) {
      setCode(reqState.devCode);
    }
  }, [reqState.devCode]);

  const otpSent = !!reqState.phone && !reqState.error;

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!reqState.phone) return;
    setSubmitting(true);
    try {
      const result = await signIn("phone", {
        phone: reqState.phone,
        code: code.trim(),
        name: mode === "REGISTER" ? name.trim() : undefined,
        redirect: false,
      });
      if (!result || result.error) {
        toast.error("Invalid or expired code.");
        return;
      }
      toast.success(mode === "REGISTER" ? "Welcome to Ayus!" : "Signed in.");
      router.push("/dashboard");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="w-full max-w-md mx-auto px-4 py-10 space-y-6">
      <div className="text-center space-y-3">
        <Link href="/" className="inline-block">
          <Logo size="md" />
        </Link>
        <div>
          <h1 className="font-heading text-2xl font-semibold">
            {mode === "REGISTER" ? "Create your account" : "Welcome back"}
          </h1>
          <p className="text-sm text-muted-foreground pt-1">
            {mode === "REGISTER"
              ? "No passwords. Just your phone number and a one-time code."
              : "Sign in with your phone number and a one-time code."}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            {otpSent ? <KeyRound className="size-4 text-primary" /> : <Phone className="size-4 text-primary" />}
            {otpSent ? "Enter the code" : mode === "REGISTER" ? "Tell us who you are" : "Enter your phone"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!otpSent ? (
            <form action={reqAction} className="space-y-4">
              {mode === "REGISTER" && (
                <div className="space-y-1.5">
                  <Label htmlFor="name">Your name</Label>
                  <Input
                    id="name"
                    name="name"
                    placeholder="e.g. Venkat"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="phone">Phone number</Label>
                <div className="flex gap-2">
                  <select
                    aria-label="Country code"
                    value={dialCode}
                    onChange={(e) => setDialCode(e.target.value)}
                    className="h-9 shrink-0 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:border-ring"
                  >
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.dial}>
                        {c.flag} {c.dial}
                      </option>
                    ))}
                  </select>
                  <Input
                    id="phone"
                    type="tel"
                    inputMode="numeric"
                    placeholder="98765 43210"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/[^\d]/g, ""))}
                    autoComplete="tel-national"
                    required
                    className="flex-1"
                  />
                </div>
                {/* Submitted value — full E.164 (dial code + national number). */}
                <input type="hidden" name="phone" value={`${dialCode}${phone}`} />
                <p className="text-[11px] text-muted-foreground">
                  We'll send a 6-digit code via WhatsApp. Select your country, then enter your number.
                </p>
              </div>
              <Button type="submit" className="w-full" disabled={reqPending}>
                {reqPending ? <><Loader2 className="mr-2 size-4 animate-spin" />Sending…</> : "Send OTP"}
              </Button>
              {reqState.error && (
                <p className="text-xs text-destructive">{reqState.error}</p>
              )}
            </form>
          ) : (
            <form onSubmit={verify} className="space-y-4">
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm">
                  <span className="font-mono">{reqState.phone}</span>
                  <button
                    type="button"
                    onClick={() => {
                      // Reset to request phase by clearing the form + state
                      setCode("");
                      location.reload();
                    }}
                    className="text-xs text-primary hover:underline flex items-center gap-1"
                  >
                    <ArrowLeft className="size-3" /> change
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="code">One-time code</Label>
                <Input
                  id="code"
                  name="code"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  autoComplete="one-time-code"
                  autoFocus
                  required
                  className="text-center text-lg tracking-widest font-mono"
                />
              </div>
              <Button type="submit" className="w-full" disabled={submitting || code.length < 4}>
                {submitting ? <><Loader2 className="mr-2 size-4 animate-spin" />Verifying…</> : mode === "REGISTER" ? "Create account" : "Sign in"}
              </Button>

              {reqState.demo && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs flex items-start gap-2">
                  <Info className="size-3.5 shrink-0 mt-0.5 text-amber-600" />
                  <div>
                    <p className="font-medium text-amber-800 dark:text-amber-400">Demo mode</p>
                    <p className="text-muted-foreground">
                      Twilio credentials aren't set. The code is <code className="font-mono bg-muted px-1 rounded">{reqState.devCode ?? "123456"}</code>.
                      Works for any phone starting with <code className="font-mono bg-muted px-1 rounded">+1555…</code>, <code className="font-mono bg-muted px-1 rounded">+91000…</code>, or <code className="font-mono bg-muted px-1 rounded">+919999999999</code>.
                    </p>
                  </div>
                </div>
              )}
            </form>
          )}
        </CardContent>
      </Card>

      <div className="text-center text-sm text-muted-foreground">
        {mode === "REGISTER" ? (
          <>Already have an account? <Link href="/login" className="text-primary hover:underline">Sign in</Link></>
        ) : (
          <>New to Ayus? <Link href="/register" className="text-primary hover:underline">Create an account</Link></>
        )}
      </div>

      <div className="flex justify-center text-xs text-muted-foreground">
        <Badge variant="outline" className="rounded-full">
          Built in India · DPDP compliant
        </Badge>
      </div>
    </div>
  );
}
