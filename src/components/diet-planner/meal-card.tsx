"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Coffee, UtensilsCrossed, Sandwich, Apple, Soup, Moon,
  RefreshCw, Trash2, Loader2, Star, EyeOff, Lock, Unlock, Clock, ExternalLink,
} from "lucide-react";
import type { MealType } from "@prisma/client";
import { MEAL_LABEL } from "@/lib/diet-planner";
import { SwapMealDialog } from "@/components/diet-planner/swap-meal-dialog";
import {
  deleteDietSchedule, acceptDietSuggestion,
  toggleMealLock, toggleMealFavorite, toggleMealHidden,
} from "@/lib/actions/health";

const ICONS: Record<MealType, typeof Coffee> = {
  BREAKFAST: Coffee,
  MORNING_SNACK: Apple,
  LUNCH: UtensilsCrossed,
  AFTERNOON_SNACK: Sandwich,
  DINNER: Soup,
  EVENING_SNACK: Moon,
};

function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h)) return hhmm;
  const hour12 = ((h + 11) % 12) + 1;
  return `${hour12}:${String(m ?? 0).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export type MealCardMeal = {
  id: string;
  mealType: MealType;
  time: string;
  items: string;
  calories: number | null;
  restrictions: string[];
  notes: string | null;
  imageUrl?: string | null;
  cuisineTags?: string[];
  prepMinutes?: number | null;
  recipeUrl?: string | null;
  locked?: boolean;
  isFavorite?: boolean;
};

type Props = {
  meal: MealCardMeal;
  prefs: { diet: string; region: string; avoid: string };
  variant?: "detailed" | "compact";
};

export function MealCard({ meal, prefs, variant = "detailed" }: Props) {
  const router = useRouter();
  const [swapOpen, setSwapOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const Icon = ICONS[meal.mealType] ?? UtensilsCrossed;

  const cuisineTags = meal.cuisineTags ?? [];
  const isLocked = !!meal.locked;
  const isFavorite = !!meal.isFavorite;

  async function applySwap(alt: { items: string; calories?: number | null; restrictions?: string[]; reasoning: string }) {
    startTransition(async () => {
      await deleteDietSchedule(meal.id);
      await acceptDietSuggestion({
        mealType: meal.mealType,
        time: meal.time,
        items: alt.items,
        calories: alt.calories ?? null,
        restrictions: alt.restrictions ?? [],
        notes: alt.reasoning,
      });
      toast.success(`Swapped ${MEAL_LABEL[meal.mealType].toLowerCase()}`);
      router.refresh();
    });
  }

  async function remove() {
    startTransition(async () => {
      await deleteDietSchedule(meal.id);
      toast.success("Removed");
      router.refresh();
    });
  }

  async function hide() {
    startTransition(async () => {
      await toggleMealHidden(meal.id, true);
      toast.success("Hidden — you can bring it back from settings.");
      router.refresh();
    });
  }

  async function toggleLock() {
    startTransition(async () => {
      await toggleMealLock(meal.id, !isLocked);
      toast.success(isLocked ? "Unlocked" : "Locked — regenerate will skip this");
      router.refresh();
    });
  }

  async function toggleFav() {
    startTransition(async () => {
      await toggleMealFavorite(meal.id, !isFavorite);
      router.refresh();
    });
  }

  if (variant === "compact") {
    return (
      <div className="rounded-md border bg-card p-2 space-y-1 group">
        <div className="flex items-center gap-1.5">
          <Icon className="size-3 text-primary" />
          <span className="text-[10px] text-muted-foreground">{formatTime(meal.time)}</span>
          {isFavorite && <Star className="size-3 text-amber-500 fill-amber-500" />}
          {isLocked && <Lock className="size-3 text-muted-foreground" />}
          <button
            onClick={() => setSwapOpen(true)}
            className="ml-auto opacity-0 group-hover:opacity-100 transition text-muted-foreground hover:text-primary"
            title="Swap"
          >
            <RefreshCw className="size-3" />
          </button>
        </div>
        <p className="text-xs leading-tight line-clamp-3">{meal.items}</p>
        <SwapMealDialog
          open={swapOpen}
          onOpenChange={setSwapOpen}
          mealType={meal.mealType}
          currentItems={meal.items}
          prefs={prefs}
          onApply={applySwap}
        />
      </div>
    );
  }

  return (
    <>
      <Card className={isFavorite ? "ring-1 ring-amber-500/30" : undefined}>
        <CardContent className="py-3">
          <div className="flex items-start gap-3">
            {/* Image with icon fallback. Uses <img> deliberately: user-provided URLs
                may be from anywhere and next/image would require the domain in
                remotePatterns config. */}
            {meal.imageUrl ? (
              <div className="size-16 rounded-xl overflow-hidden shrink-0 bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={meal.imageUrl}
                  alt={meal.items}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </div>
            ) : (
              <div className="size-16 rounded-xl bg-linear-to-br from-primary/15 to-primary/5 text-primary flex items-center justify-center shrink-0">
                <Icon className="size-6" />
              </div>
            )}

            <div className="flex-1 min-w-0 space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium">{MEAL_LABEL[meal.mealType]}</span>
                <span className="text-xs text-muted-foreground">{formatTime(meal.time)}</span>
                {isFavorite && (
                  <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-600 dark:text-amber-400">
                    <Star className="size-2.5 mr-0.5 fill-current" /> favorite
                  </Badge>
                )}
                {isLocked && (
                  <Badge variant="outline" className="text-[10px]">
                    <Lock className="size-2.5 mr-0.5" /> locked
                  </Badge>
                )}
                {meal.calories != null && (
                  <Badge variant="secondary" className="text-[10px]">{meal.calories} kcal</Badge>
                )}
                {meal.prepMinutes != null && (
                  <Badge variant="outline" className="text-[10px]">
                    <Clock className="size-2.5 mr-0.5" /> {meal.prepMinutes} min
                  </Badge>
                )}
              </div>

              <p className="text-sm">{meal.items}</p>

              {(cuisineTags.length > 0 || meal.restrictions.length > 0) && (
                <div className="flex items-center gap-1 flex-wrap">
                  {cuisineTags.map((t) => (
                    <Badge key={t} variant="secondary" className="text-[10px] bg-primary/10 text-primary border-0">
                      {t}
                    </Badge>
                  ))}
                  {meal.restrictions.map((r) => (
                    <Badge key={r} variant="outline" className="text-[10px]">{r}</Badge>
                  ))}
                </div>
              )}

              {meal.notes && <p className="text-xs text-muted-foreground italic">{meal.notes}</p>}

              {meal.recipeUrl && (
                <a
                  href={meal.recipeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <ExternalLink className="size-3" />
                  View recipe
                </a>
              )}
            </div>

            <div className="flex flex-col items-end gap-1 shrink-0">
              <div className="flex items-center gap-0.5">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={toggleFav}
                  disabled={isPending}
                  title={isFavorite ? "Unfavorite" : "Favorite"}
                  aria-pressed={isFavorite}
                >
                  <Star className={`size-4 ${isFavorite ? "text-amber-500 fill-amber-500" : "text-muted-foreground"}`} />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={toggleLock}
                  disabled={isPending}
                  title={isLocked ? "Unlock (allow regenerate)" : "Lock (keep on regenerate)"}
                  aria-pressed={isLocked}
                >
                  {isLocked
                    ? <Lock className="size-4 text-foreground" />
                    : <Unlock className="size-4 text-muted-foreground" />}
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={hide}
                  disabled={isPending}
                  title="Hide (don't show again)"
                >
                  <EyeOff className="size-4 text-muted-foreground" />
                </Button>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSwapOpen(true)}
                  disabled={isPending || isLocked}
                  title={isLocked ? "Unlock to swap" : "Swap for something else"}
                >
                  {isPending ? <Loader2 className="size-3.5 animate-spin" /> : <><RefreshCw className="mr-1 size-3.5" />Swap</>}
                </Button>
                <Button size="icon-sm" variant="ghost" onClick={remove} disabled={isPending} title="Remove">
                  <Trash2 className="size-4 text-muted-foreground" />
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      <SwapMealDialog
        open={swapOpen}
        onOpenChange={setSwapOpen}
        mealType={meal.mealType}
        currentItems={meal.items}
        prefs={prefs}
        onApply={applySwap}
      />
    </>
  );
}
