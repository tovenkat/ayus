import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Shadcn-style typography primitives. Use these everywhere to keep sizing,
 * weight, and spacing consistent across the app.
 *
 * Docs: https://ui.shadcn.com/docs/components/typography
 */

type DivProps = React.ComponentProps<"div">;
type ParagraphProps = React.ComponentProps<"p">;
type HeadingProps = React.ComponentProps<"h1">;
type ListProps = React.ComponentProps<"ul">;
type QuoteProps = React.ComponentProps<"blockquote">;
type CodeProps = React.ComponentProps<"code">;

export function H1({ className, ...props }: HeadingProps) {
  return (
    <h1
      className={cn(
        "scroll-m-20 text-balance font-heading text-4xl font-extrabold tracking-tight lg:text-5xl",
        className,
      )}
      {...props}
    />
  );
}

export function H2({ className, ...props }: HeadingProps) {
  return (
    <h2
      className={cn(
        "scroll-m-20 font-heading text-3xl font-semibold tracking-tight first:mt-0",
        className,
      )}
      {...props}
    />
  );
}

export function H3({ className, ...props }: HeadingProps) {
  return (
    <h3
      className={cn(
        "scroll-m-20 font-heading text-2xl font-semibold tracking-tight",
        className,
      )}
      {...props}
    />
  );
}

export function H4({ className, ...props }: HeadingProps) {
  return (
    <h4
      className={cn(
        "scroll-m-20 font-heading text-xl font-semibold tracking-tight",
        className,
      )}
      {...props}
    />
  );
}

export function P({ className, ...props }: ParagraphProps) {
  return (
    <p
      className={cn("leading-7 [&:not(:first-child)]:mt-4", className)}
      {...props}
    />
  );
}

export function Lead({ className, ...props }: ParagraphProps) {
  return (
    <p
      className={cn("text-muted-foreground text-lg text-balance", className)}
      {...props}
    />
  );
}

export function Large({ className, ...props }: DivProps) {
  return (
    <div
      className={cn("text-lg font-semibold", className)}
      {...props}
    />
  );
}

export function Small({ className, ...props }: DivProps) {
  return (
    <div
      className={cn("text-sm leading-none font-medium", className)}
      {...props}
    />
  );
}

export function Muted({ className, ...props }: ParagraphProps) {
  return (
    <p
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  );
}

export function Blockquote({ className, ...props }: QuoteProps) {
  return (
    <blockquote
      className={cn("mt-6 border-l-2 pl-6 italic", className)}
      {...props}
    />
  );
}

export function UnorderedList({ className, ...props }: ListProps) {
  return (
    <ul
      className={cn("my-6 ml-6 list-disc [&>li]:mt-2", className)}
      {...props}
    />
  );
}

export function InlineCode({ className, ...props }: CodeProps) {
  return (
    <code
      className={cn(
        "bg-muted relative rounded px-[0.3rem] py-[0.2rem] font-mono text-sm font-semibold",
        className,
      )}
      {...props}
    />
  );
}

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4 flex-wrap", className)}>
      <div className="space-y-1">
        <H1 className="text-3xl lg:text-4xl">{title}</H1>
        {description && <Muted>{description}</Muted>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
