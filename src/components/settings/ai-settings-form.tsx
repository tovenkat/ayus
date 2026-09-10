"use client";

import { useState, useEffect } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { MODELS, PRICING, modelsForTier } from "@/lib/pricing";
import type { AiProvider, SubscriptionTier } from "@prisma/client";
import { Check, ExternalLink, Key, Lock, Server, Sparkles, Cpu, HardDrive } from "lucide-react";

type Props = {
  initial: {
    aiProvider: AiProvider | null;
    aiModel: string | null;
    privacyMode: boolean;
    cloudExtractionOptIn: boolean;
    hasByokKey: boolean;
    vllmBaseUrl: string | null;
    llamaCppBaseUrl: string | null;
    tier: SubscriptionTier;
  };
};

const THIRD_PARTY_CLOUD: AiProvider[] = ["GEMINI", "OPENAI", "CLAUDE", "AZURE_OPENAI", "BEDROCK", "VERTEX"];

type ProviderMeta = {
  id: AiProvider;
  name: string;
  blurb: string;
  keyUrl: string | null;
  keyLabel: string | null;
  icon: typeof Cpu;
};

const PROVIDERS: ProviderMeta[] = [
  {
    id: "OLLAMA_LOCAL",
    name: "Local (Ollama)",
    blurb: "100% offline. Runs on your own machine. Zero cost, slower.",
    keyUrl: null,
    keyLabel: null,
    icon: Cpu,
  },
  {
    id: "VLLM",
    name: "Self-hosted (vLLM)",
    blurb: "OpenAI-compatible endpoint on your own GPU. Zero per-token cost, fast.",
    keyUrl: null,
    keyLabel: null,
    icon: Server,
  },
  {
    id: "LLAMACPP",
    name: "Self-hosted (llama.cpp)",
    blurb: "Point at a llama-server binary you started with a GGUF model. Runs on CPU or Metal.",
    keyUrl: null,
    keyLabel: null,
    icon: HardDrive,
  },
  {
    id: "GEMINI",
    name: "Google Gemini",
    blurb: "Cheapest cloud + native PDF reading. Free tier available.",
    keyUrl: "https://aistudio.google.com/app/apikey",
    keyLabel: "Get free Gemini key",
    icon: Sparkles,
  },
  {
    id: "OPENAI",
    name: "OpenAI",
    blurb: "GPT-4o family. Strong structured output.",
    keyUrl: "https://platform.openai.com/api-keys",
    keyLabel: "Get OpenAI key",
    icon: Sparkles,
  },
  {
    id: "CLAUDE",
    name: "Anthropic Claude",
    blurb: "Premium accuracy on medical tables.",
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyLabel: "Get Claude key",
    icon: Sparkles,
  },
];

export function AiSettingsForm({ initial }: Props) {
  const [provider, setProvider] = useState<AiProvider | "INHERIT">(initial.aiProvider ?? "INHERIT");
  const [model, setModel] = useState<string | "INHERIT">(initial.aiModel ?? "INHERIT");
  const [apiKey, setApiKey] = useState("");
  const [privacyMode, setPrivacyMode] = useState(initial.privacyMode);
  const [cloudExtraction, setCloudExtraction] = useState(initial.cloudExtractionOptIn);
  const [hasByokKey, setHasByokKey] = useState(initial.hasByokKey);
  const [vllmBaseUrl, setVllmBaseUrl] = useState(initial.vllmBaseUrl ?? "");
  const [vllmModelInput, setVllmModelInput] = useState(initial.aiProvider === "VLLM" ? (initial.aiModel ?? "") : "");
  const [llamaCppBaseUrl, setLlamaCppBaseUrl] = useState(initial.llamaCppBaseUrl ?? "");
  const [llamaCppModelInput, setLlamaCppModelInput] = useState(initial.aiProvider === "LLAMACPP" ? (initial.aiModel ?? "") : "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (provider === "INHERIT") setModel("INHERIT");
  }, [provider]);

  const tierMdls = modelsForTier(initial.tier);
  const tierAllowsByok = PRICING[initial.tier].byokAllowed;

  const availableModels =
    provider === "INHERIT" || provider === "OLLAMA_LOCAL" || provider === "VLLM" || provider === "LLAMACPP"
      ? []
      : MODELS.filter((m) => {
          if (m.provider !== provider) return false;
          return tierMdls.some((tm) => tm.id === m.id);
        });

  const providersAllowed = provider === "INHERIT"
    ? []
    : PROVIDERS.filter((p) => {
        if (p.id === "OLLAMA_LOCAL" || p.id === "VLLM" || p.id === "LLAMACPP") return true;
        return tierMdls.some((m) => m.provider === p.id);
      });

  const selectedMeta = provider !== "INHERIT" ? PROVIDERS.find((p) => p.id === provider) : null;

  async function save() {
    setSaving(true);
    try {
      const effectiveModel =
        provider === "VLLM" ? (vllmModelInput.trim() || null)
        : provider === "LLAMACPP" ? (llamaCppModelInput.trim() || null)
        : model === "INHERIT" ? null
        : model;

      const res = await fetch("/api/user/ai-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: provider === "INHERIT" ? null : provider,
          model: effectiveModel,
          apiKey: apiKey || undefined,
          vllmBaseUrl: provider === "VLLM" ? (vllmBaseUrl.trim() || "") : undefined,
          llamaCppBaseUrl: provider === "LLAMACPP" ? (llamaCppBaseUrl.trim() || "") : undefined,
          privacyMode,
          cloudExtractionOptIn: cloudExtraction,
        }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Failed to save" }));
        toast.error(error);
        return;
      }
      if (apiKey) setHasByokKey(true);
      toast.success("AI settings saved");
      setApiKey("");
    } finally {
      setSaving(false);
    }
  }

  // ── Status strip ──────────────────────────────────────────────────────────
  const status =
    privacyMode
      ? { color: "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/30", label: "Privacy mode — running 100% locally on Ollama" }
      : provider === "INHERIT"
        ? { color: "bg-muted/50 text-muted-foreground border-border", label: "Using organization default" }
        : provider === "OLLAMA_LOCAL"
          ? { color: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border-cyan-500/30", label: "Running locally on Ollama" }
          : hasByokKey
            ? { color: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30", label: `${selectedMeta?.name ?? provider} configured with your key` }
            : { color: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30", label: `${selectedMeta?.name ?? provider} selected — add your API key below` };

  return (
    <div id="ai" className="space-y-5 scroll-mt-20">
      {/* Current status */}
      <div className={`rounded-md border px-3 py-2 text-xs flex items-center gap-2 ${status.color}`}>
        <Check className="size-3.5" />
        <span>{status.label}</span>
      </div>

      {/* Privacy mode switch */}
      <div className="flex items-center justify-between rounded-md border p-3">
        <div className="space-y-1 pr-4">
          <Label htmlFor="privacy" className="font-medium text-sm">Privacy mode</Label>
          <p className="text-xs text-muted-foreground">
            Force all extraction to run locally on Ollama. Overrides any cloud provider you pick below.
            Requires Ollama running at <code>localhost:11434</code>.
          </p>
        </div>
        <Switch id="privacy" checked={privacyMode} onCheckedChange={setPrivacyMode} />
      </div>

      {/* Provider picker — visual cards instead of dropdown */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Choose your AI provider</Label>
        <div className="grid sm:grid-cols-2 gap-2">
          {PROVIDERS.map((p) => {
            const disabledByTier =
              p.id !== "OLLAMA_LOCAL" && p.id !== "VLLM" && p.id !== "LLAMACPP"
              && !tierMdls.some((m) => m.provider === p.id);
            const selected = provider === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => !disabledByTier && !privacyMode && setProvider(p.id)}
                disabled={disabledByTier || privacyMode}
                className={`text-left rounded-md border p-3 transition ${
                  selected
                    ? "border-primary ring-1 ring-primary/20 bg-primary/5"
                    : disabledByTier || privacyMode
                      ? "opacity-40 cursor-not-allowed"
                      : "hover:bg-muted/50"
                }`}
              >
                <div className="flex items-start gap-2">
                  <div className={`size-8 rounded-md flex items-center justify-center shrink-0 ${selected ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                    <p.icon className="size-4" />
                  </div>
                  <div className="min-w-0 space-y-0.5 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium">{p.name}</span>
                      {selected && <Check className="size-3.5 text-primary" />}
                      {disabledByTier && (
                        <Badge variant="outline" className="text-[9px] ml-auto">
                          Upgrade
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{p.blurb}</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        {provider !== "INHERIT" && (
          <button
            type="button"
            className="text-xs text-muted-foreground hover:underline"
            onClick={() => setProvider("INHERIT")}
          >
            ← Use organization default instead
          </button>
        )}
      </div>

      {/* Model picker — cloud providers get a Select; vLLM/llama.cpp get free-text Inputs (below) */}
      {provider !== "INHERIT" && provider !== "OLLAMA_LOCAL" && provider !== "VLLM" && provider !== "LLAMACPP" && (
        <div className="space-y-1.5">
          <Label className="text-sm">Model</Label>
          <Select value={model} onValueChange={(v) => setModel(v ?? "INHERIT")}>
            <SelectTrigger>
              <SelectValue placeholder="Use provider default" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="INHERIT">Use provider default</SelectItem>
              {availableModels.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  <span className="font-medium">{m.label}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    ${m.inputUsdPerMillion}/1M in · ${m.outputUsdPerMillion}/1M out
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {availableModels.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No models available on the {PRICING[initial.tier].label} tier.{" "}
              <a href="/pricing" className="underline">Upgrade</a> for more.
            </p>
          )}
        </div>
      )}

      {/* vLLM: base URL + free-text model */}
      {provider === "VLLM" && (
        <Card className="p-4 space-y-3 bg-muted/30">
          <div className="flex items-center gap-2">
            <Server className="size-4 text-primary" />
            <p className="text-sm font-medium">vLLM endpoint</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vllm-url" className="text-xs">Base URL</Label>
            <Input
              id="vllm-url"
              type="url"
              placeholder="http://localhost:8001/v1"
              value={vllmBaseUrl}
              onChange={(e) => setVllmBaseUrl(e.target.value)}
            />
            <p className="text-[10px] text-muted-foreground">
              Include the <code>/v1</code> suffix. Falls back to the <code>VLLM_BASE_URL</code> env var if left blank.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="vllm-model" className="text-xs">Model id</Label>
            <Input
              id="vllm-model"
              type="text"
              placeholder="e.g. Qwen/Qwen2.5-7B-Instruct"
              value={vllmModelInput}
              onChange={(e) => setVllmModelInput(e.target.value)}
            />
            <p className="text-[10px] text-muted-foreground">
              Match whatever model your vLLM server was launched with (<code>--model</code>).
            </p>
          </div>
        </Card>
      )}

      {/* llama.cpp: base URL + free-text model */}
      {provider === "LLAMACPP" && (
        <Card className="p-4 space-y-3 bg-muted/30">
          <div className="flex items-center gap-2">
            <HardDrive className="size-4 text-primary" />
            <p className="text-sm font-medium">llama.cpp endpoint</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="llamacpp-url" className="text-xs">Base URL</Label>
            <Input
              id="llamacpp-url"
              type="url"
              placeholder="http://localhost:8080/v1"
              value={llamaCppBaseUrl}
              onChange={(e) => setLlamaCppBaseUrl(e.target.value)}
            />
            <p className="text-[10px] text-muted-foreground">
              Include the <code>/v1</code> suffix. Falls back to the <code>LLAMACPP_BASE_URL</code> env var if left blank. Default port for <code>llama-server</code> is 8080.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="llamacpp-model" className="text-xs">Model id</Label>
            <Input
              id="llamacpp-model"
              type="text"
              placeholder="e.g. gemma-3-4b-it-Q4_K_M"
              value={llamaCppModelInput}
              onChange={(e) => setLlamaCppModelInput(e.target.value)}
            />
            <p className="text-[10px] text-muted-foreground">
              Any string works when llama-server is running a single model (use <code>--alias</code> to set a friendly name).
            </p>
          </div>
        </Card>
      )}

      {/* BYOK key input */}
      {provider !== "INHERIT" && provider !== "OLLAMA_LOCAL" && selectedMeta?.keyUrl && (
        <Card className="p-4 space-y-3 bg-muted/30">
          <div className="flex items-center gap-2">
            <Key className="size-4 text-primary" />
            <p className="text-sm font-medium">Your {selectedMeta.name} API key</p>
            {hasByokKey && (
              <Badge variant="outline" className="text-[10px] bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400">
                Saved
              </Badge>
            )}
          </div>

          {tierAllowsByok ? (
            <>
              <Input
                type="password"
                placeholder={hasByokKey ? "●●●●●●●●●● (saved) — enter new to replace" : "Paste your API key"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <div className="flex items-center justify-between gap-2">
                <a
                  href={selectedMeta.keyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                >
                  {selectedMeta.keyLabel} <ExternalLink className="size-3" />
                </a>
                <p className="text-[10px] text-muted-foreground">
                  Encrypted at rest · never sent to our servers unencrypted
                </p>
              </div>
            </>
          ) : (
            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Lock className="size-3.5" />
              <span>
                BYOK available from <Badge variant="outline" className="text-[10px] mx-1">Personal</Badge> tier and above.{" "}
                <a href="/pricing" className="underline">Upgrade</a>.
              </span>
            </div>
          )}
        </Card>
      )}

      {/* Extraction scope — only relevant for third-party cloud providers. */}
      {!privacyMode && provider !== "INHERIT" && THIRD_PARTY_CLOUD.includes(provider as AiProvider) && (
        <Card className="p-4 space-y-3 bg-muted/30">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1 pr-2">
              <div className="flex items-center gap-2">
                <Lock className="size-4 text-primary" />
                <p className="text-sm font-medium">Use {selectedMeta?.name ?? "this provider"} for document extraction too</p>
              </div>
              <p className="text-xs text-muted-foreground">
                By default your lab reports are parsed <strong>locally</strong> — raw documents never leave this server.
                Turn this on to also send full report text/images to {selectedMeta?.name ?? "your provider"} for
                higher-accuracy extraction. Uses more of your quota. Chat, diet, and visit-prep always use your provider.
              </p>
            </div>
            <Switch id="cloud-extraction" checked={cloudExtraction} onCheckedChange={setCloudExtraction} />
          </div>
        </Card>
      )}

      <div className="flex items-center justify-between pt-2 border-t">
        <p className="text-xs text-muted-foreground">
          Changes take effect on your next upload — no restart needed.
        </p>
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save AI settings"}
        </Button>
      </div>
    </div>
  );
}
