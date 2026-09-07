"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Share2 } from "lucide-react";
import { ShareDialog } from "@/components/share/share-dialog";
import type { ShareResource } from "@prisma/client";
import type { ComponentProps } from "react";

type ButtonVariant = ComponentProps<typeof Button>["variant"];
type ButtonSize = ComponentProps<typeof Button>["size"];

type Props = {
  resource: ShareResource;
  resourceId?: string;
  snapshotJson?: unknown;
  label: string;
  buttonLabel?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
};

export function ShareButton({
  resource,
  resourceId,
  snapshotJson,
  label,
  buttonLabel = "Share via WhatsApp",
  variant = "default",
  size = "sm",
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} size={size} className={className} onClick={() => setOpen(true)}>
        <Share2 className="mr-2 size-4" />
        {buttonLabel}
      </Button>
      <ShareDialog
        open={open}
        onOpenChange={setOpen}
        resource={resource}
        resourceId={resourceId}
        snapshotJson={snapshotJson}
        label={label}
      />
    </>
  );
}
