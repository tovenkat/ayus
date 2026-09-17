"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { Bot, User, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

// Document citation — matches what /api/chat streams (one per source wiki doc).
export interface Citation {
  documentId: string;
  slug: string;
  title: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  citations?: Citation[] | null;
  createdAt?: string;
}

interface ChatMessagesProps {
  messages: ChatMessage[];
  streamingContent: string;
  isStreaming: boolean;
  disclaimer: string | null;
}

function AssistantMessage({
  message,
  disclaimer,
}: {
  message: ChatMessage;
  disclaimer?: string | null;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
        <Bot className="h-4 w-4 text-primary" />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
          <ReactMarkdown>{message.content}</ReactMarkdown>
        </div>

        {message.citations && message.citations.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {Array.from(
              new Map(message.citations.map((c) => [c.documentId, c])).values(),
            ).map((c) => (
              <Link key={c.documentId} href={`/wiki/${c.slug}`}>
                <Badge variant="outline" className="text-[10px] cursor-pointer hover:bg-background/50">
                  <FileText className="size-2.5 mr-1" />
                  {c.title}
                </Badge>
              </Link>
            ))}
          </div>
        )}

        {disclaimer && (
          <p className="text-xs text-muted-foreground italic border-l-2 border-muted pl-2 mt-2">
            {disclaimer}
          </p>
        )}
      </div>
    </div>
  );
}

function UserMessage({ message }: { message: ChatMessage }) {
  return (
    <div className="flex gap-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
        <User className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-sm whitespace-pre-wrap">{message.content}</p>
      </div>
    </div>
  );
}

function StreamingMessage({ content }: { content: string }) {
  return (
    <div className="flex gap-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
        <Bot className="h-4 w-4 text-primary" />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        {content ? (
          <div className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        ) : (
          <div className="flex items-center gap-1 pt-1">
            <span className="h-2 w-2 animate-pulse rounded-full bg-primary/60" />
            <span className="h-2 w-2 animate-pulse rounded-full bg-primary/60 [animation-delay:150ms]" />
            <span className="h-2 w-2 animate-pulse rounded-full bg-primary/60 [animation-delay:300ms]" />
          </div>
        )}
      </div>
    </div>
  );
}

export function ChatMessages({
  messages,
  streamingContent,
  isStreaming,
  disclaimer,
}: ChatMessagesProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  if (messages.length === 0 && !isStreaming) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center space-y-2">
          <Bot className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="text-lg font-medium">Ask me about your health records</p>
          <p className="text-sm text-muted-foreground max-w-sm">
            I can help you understand your lab results, explain test values, and
            track trends. Toggle &quot;Use my records&quot; to include your data.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className="mx-auto max-w-2xl space-y-6 p-4">
        {messages.map((msg, i) =>
          msg.role === "user" ? (
            <UserMessage key={msg.id} message={msg} />
          ) : (
            <AssistantMessage
              key={msg.id}
              message={msg}
              disclaimer={i === messages.length - 1 && !isStreaming ? disclaimer : null}
            />
          )
        )}

        {isStreaming && <StreamingMessage content={streamingContent} />}

        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
