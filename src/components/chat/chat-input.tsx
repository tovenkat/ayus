"use client";

import { useState, useRef, useCallback } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

interface ChatInputProps {
  onSend: (message: string, useRecords: boolean) => void;
  disabled: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [input, setInput] = useState("");
  // Default ON: this is a personal health app, so the assistant should use the
  // user's live snapshot + records by default. Turning it OFF asks a purely
  // general health question with no personal data attached.
  const [useRecords, setUseRecords] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed, useRecords);
    setInput("");
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [input, useRecords, disabled, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    // Auto-resize textarea
    const textarea = e.target;
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 160) + "px";
  };

  return (
    <div className="border-t bg-background p-4">
      <div className="mx-auto max-w-2xl space-y-3">
        <div className="flex items-center gap-3">
          <Tooltip>
            <TooltipTrigger>
              <div className="flex items-center gap-2">
                <Switch
                  id="use-records"
                  checked={useRecords}
                  onCheckedChange={setUseRecords}
                />
                <Label
                  htmlFor="use-records"
                  className="cursor-pointer text-sm select-none"
                >
                  Use my records
                </Label>
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs">
              When enabled, the assistant can access your uploaded lab results to
              give personalized answers. Your data is never shared externally.
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your health data..."
            disabled={disabled}
            rows={1}
            className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 flex-1 resize-none rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] disabled:opacity-50"
          />
          <Button
            size="icon"
            onClick={handleSubmit}
            disabled={disabled || !input.trim()}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
