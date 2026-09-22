"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { MessageCircle, X, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatMessages, type ChatMessage, type Citation } from "./chat-messages";
import { ChatInput } from "./chat-input";
import { AiDisclaimer } from "@/components/ui/ai-disclaimer";

export function ChatFab() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingContent, setStreamingContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [disclaimer, setDisclaimer] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  // Close popup when navigating to /chat
  useEffect(() => {
    if (pathname.startsWith("/chat")) setOpen(false);
  }, [pathname]);

  const handleSend = useCallback(
    async (message: string, useRecords: boolean) => {
      const userMsg: ChatMessage = {
        id: `temp-${Date.now()}`,
        role: "user",
        content: message,
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsStreaming(true);
      setStreamingContent("");
      setDisclaimer(null);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: sessionId ?? undefined,
            message,
            healthMode: useRecords,
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Request failed" }));
          setMessages((prev) => [
            ...prev,
            {
              id: `err-${Date.now()}`,
              role: "assistant",
              content: err.error ?? "Something went wrong. Please try again.",
            },
          ]);
          setIsStreaming(false);
          return;
        }

        if (!res.body) {
          setIsStreaming(false);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";
        let currentSessionId = sessionId;
        let citations: Citation[] = [];
        let buffer = "";

        // Server emits NDJSON: one JSON object per line, no "data:" prefix.
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const raw of lines) {
            const line = raw.trim();
            if (!line) continue;

            try {
              const data = JSON.parse(line);
              switch (data.type) {
                case "session":
                  currentSessionId = data.sessionId;
                  if (!sessionId) setSessionId(currentSessionId);
                  break;
                case "token":
                  accumulated += data.content;
                  setStreamingContent(accumulated);
                  break;
                case "citations":
                  citations = data.citations ?? [];
                  break;
                case "done":
                  break;
                case "error":
                  accumulated += `\n\n_Error: ${data.error}_`;
                  setStreamingContent(accumulated);
                  break;
              }
            } catch {
              // skip malformed line
            }
          }
        }

        if (accumulated) {
          setMessages((prev) => [
            ...prev,
            {
              id: `asst-${Date.now()}`,
              role: "assistant",
              content: accumulated,
              citations: citations.length > 0 ? citations : null,
            },
          ]);
        }
        setStreamingContent("");
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Network error";
        setMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: "assistant",
            content: `Something went wrong: ${errMsg}. Please try again.`,
          },
        ]);
      } finally {
        setIsStreaming(false);
      }
    },
    [sessionId]
  );

  if (pathname.startsWith("/chat")) return null;

  return (
    <>
      {/* Popup chat window */}
      {open && (
        <div className="fixed bottom-20 right-6 z-50 flex h-[min(32rem,calc(100vh-8rem))] w-[min(24rem,calc(100vw-3rem))] flex-col overflow-hidden rounded-xl border bg-background shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b px-4 py-2">
            <span className="text-sm font-medium">Chat</span>
            <div className="flex items-center gap-1">
              <Link href="/chat">
                <Button variant="ghost" size="icon" className="h-7 w-7" title="Open full chat">
                  <Maximize2 className="h-3.5 w-3.5" />
                </Button>
              </Link>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setOpen(false)}
                title="Close"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Messages — force min-h-0 on ScrollArea via CSS so it shrinks */}
          <div className="flex min-h-0 flex-1 flex-col [&_[data-slot=scroll-area]]:min-h-0">
            <ChatMessages
              messages={messages}
              streamingContent={streamingContent}
              isStreaming={isStreaming}
              disclaimer={disclaimer}
            />
          </div>

          {/* Input — shrink-0 keeps it pinned at bottom */}
          <div className="shrink-0">
            <ChatInput onSend={handleSend} disabled={isStreaming} />
            <div className="border-t px-3 pb-2">
              <AiDisclaimer variant="inline" />
            </div>
          </div>
        </div>
      )}

      {/* FAB toggle */}
      <Button
        size="icon"
        className="fixed bottom-6 right-6 z-50 h-12 w-12 rounded-full shadow-lg"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <X className="h-5 w-5" />
        ) : (
          <MessageCircle className="h-5 w-5" />
        )}
        <span className="sr-only">{open ? "Close chat" : "Open chat"}</span>
      </Button>
    </>
  );
}
