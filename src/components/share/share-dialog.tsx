"use client";

import { useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Copy, ExternalLink, MessageCircle, Loader2, Check, Mail } from "lucide-react";
import type { ShareResource } from "@prisma/client";

type ShareExpiry = "24H" | "48H" | "7D" | "30D";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resource: ShareResource;
  resourceId?: string;
  /** Optional pre-rendered snapshot; required for VISIT_PREP-style time-sensitive resources. */
  snapshotJson?: unknown;
  /** Short label used in the dialog header (e.g. "Emergency Card"). */
  label: string;
};

export function ShareDialog({ open, onOpenChange, resource, resourceId, snapshotJson, label }: Props) {
  const [expiry, setExpiry] = useState<ShareExpiry>("48H");
  const [pin, setPin] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ url: string; expiresAt: string; sent: boolean } | null>(null);

  function reset() {
    setExpiry("48H");
    setPin("");
    setRecipientName("");
    setRecipientPhone("");
    setRecipientEmail("");
    setResult(null);
  }

  /**
   * Build a mailto URL that opens the user's mail client with the share link
   * pre-filled. We deliberately DON'T send email server-side — no SMTP config
   * to maintain, and the sender's client stamps the "from" for deliverability.
   */
  function openMailto(to: string, url: string, expiresAt: string) {
    const subject = `${label} shared with you via Ayus`;
    const expLabel = new Date(expiresAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    const bodyLines = [
      `Hi${recipientName ? " " + recipientName : ""},`,
      "",
      `I'm sharing my ${label.toLowerCase()} with you via Ayus.`,
      "",
      `Open here: ${url}`,
      ...(pin ? [`Access PIN: ${pin}`] : []),
      `Link expires: ${expLabel}`,
      "",
      "This is a read-only view — no account needed.",
    ];
    const body = encodeURIComponent(bodyLines.join("\n"));
    // Use assign — some browsers block window.open for mailto without user gesture.
    window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${body}`;
  }

  async function createLink(via: "link" | "whatsapp" | "email") {
    if (via === "whatsapp" && !recipientPhone.trim()) {
      toast.error("Enter the recipient's phone number to send via WhatsApp.");
      return;
    }
    if (via === "email" && !recipientEmail.trim()) {
      toast.error("Enter the recipient's email address.");
      return;
    }
    if (via === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipientEmail.trim())) {
      toast.error("That doesn't look like a valid email address.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resource,
          resourceId: resourceId ?? null,
          snapshotJson,
          pin: pin || undefined,
          recipientName: recipientName || undefined,
          recipientPhone: recipientPhone || undefined,
          expiry,
          sendWhatsApp: via === "whatsapp",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't create link");
        return;
      }
      setResult({ url: data.url, expiresAt: data.expiresAt, sent: !!data.sentViaWhatsApp });
      if (via === "whatsapp") {
        if (data.sentViaWhatsApp) {
          toast.success(`Sent to ${recipientName || recipientPhone} via WhatsApp.`);
        } else if (data.whatsAppError) {
          toast.error(`Link created, but WhatsApp failed: ${data.whatsAppError}`);
        }
      } else if (via === "email") {
        openMailto(recipientEmail.trim(), data.url, data.expiresAt);
        toast.success("Opening your mail client — review and send.");
      } else {
        toast.success("Link created — copy it below.");
      }
    } finally {
      setLoading(false);
    }
  }

  function copy() {
    if (!result) return;
    navigator.clipboard.writeText(result.url);
    toast.success("Link copied to clipboard.");
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Share {label} with a doctor</DialogTitle>
          <DialogDescription>
            Create a read-only link that expires. Send it over WhatsApp or copy it.
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="rname" className="text-xs">Recipient name <span className="text-muted-foreground">(optional)</span></Label>
                <Input id="rname" value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="Dr. Raghavan" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rphone" className="text-xs">WhatsApp number</Label>
                <Input
                  id="rphone"
                  type="tel"
                  value={recipientPhone}
                  onChange={(e) => setRecipientPhone(e.target.value)}
                  placeholder="+91 98765 43210"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="remail" className="text-xs">Email address</Label>
              <Input
                id="remail"
                type="email"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                placeholder="doctor@clinic.example"
              />
              <p className="text-[11px] text-muted-foreground">
                Fill in either WhatsApp or email — or both. The dialog opens your mail app to send from your own address.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Expires in</Label>
                <Select value={expiry} onValueChange={(v) => setExpiry((v ?? "48H") as ShareExpiry)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="24H">24 hours</SelectItem>
                    <SelectItem value="48H">48 hours</SelectItem>
                    <SelectItem value="7D">7 days</SelectItem>
                    <SelectItem value="30D">30 days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pin" className="text-xs">PIN <span className="text-muted-foreground">(4–6 digits, optional)</span></Label>
                <Input
                  id="pin"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="e.g. 4242"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                />
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground">
              The link is read-only. Your data is never sent to the doctor's device — they only see it in their browser.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-md border bg-muted/30 p-3 space-y-2">
              <Label className="text-xs text-muted-foreground">Share link</Label>
              <div className="flex gap-2">
                <Input value={result.url} readOnly className="font-mono text-xs" />
                <Button variant="outline" size="sm" onClick={copy} title="Copy">
                  <Copy className="size-4" />
                </Button>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Expires {new Date(result.expiresAt).toLocaleString()}</span>
                {result.sent && <Badge variant="outline" className="text-[10px]"><Check className="size-3 mr-1" />Sent via WhatsApp</Badge>}
              </div>
            </div>
            <a href={result.url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
              Open in new tab <ExternalLink className="size-3" />
            </a>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-end flex-wrap">
          {!result ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
                Cancel
              </Button>
              <Button variant="outline" onClick={() => createLink("link")} disabled={loading}>
                {loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Copy className="mr-2 size-4" />}
                Just create link
              </Button>
              <Button
                variant="outline"
                onClick={() => createLink("email")}
                disabled={loading || !recipientEmail.trim()}
                title={!recipientEmail.trim() ? "Enter an email address above" : "Compose email"}
              >
                {loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Mail className="mr-2 size-4" />}
                Send via Email
              </Button>
              <Button
                onClick={() => createLink("whatsapp")}
                disabled={loading || !recipientPhone.trim()}
                title={!recipientPhone.trim() ? "Enter a WhatsApp number above" : "Send via WhatsApp"}
              >
                {loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : <MessageCircle className="mr-2 size-4" />}
                Send via WhatsApp
              </Button>
            </>
          ) : (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
