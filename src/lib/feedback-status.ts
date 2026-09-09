/** Pure labels/colors for feedback status + type — safe for client & server. */

export const FEEDBACK_STATUSES = ["OPEN", "PLANNED", "RESOLVED", "DECLINED"] as const;
export type FeedbackStatusKey = (typeof FEEDBACK_STATUSES)[number];

export const STATUS_META: Record<FeedbackStatusKey, { label: string; badge: string }> = {
  OPEN:     { label: "Open",     badge: "text-blue-600 border-blue-500/30 bg-blue-500/10" },
  PLANNED:  { label: "Planned",  badge: "text-amber-600 border-amber-500/30 bg-amber-500/10" },
  RESOLVED: { label: "Resolved", badge: "text-emerald-600 border-emerald-500/30 bg-emerald-500/10" },
  DECLINED: { label: "Declined", badge: "text-muted-foreground border-border bg-muted/40" },
};

export const FEEDBACK_TYPE_LABEL: Record<string, string> = {
  FEATURE: "Feature idea",
  PROBLEM: "Problem",
  OTHER: "Other",
};
