"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TodayView } from "@/components/diet-planner/today-view";
import { WeeklyPlanner } from "@/components/diet-planner/weekly-planner";
import { GroceryList } from "@/components/diet-planner/grocery-list";
import { VarietyInsights } from "@/components/diet-planner/variety-insights";
import { AiMealAssistant } from "@/components/diet-planner/ai-meal-assistant";
import { PreferencesPanel } from "@/components/diet-planner/preferences-panel";
import { DietSuggest } from "@/components/health/diet-suggest";
import { DietForm } from "@/components/health/diet-form";
import {
  CalendarDays, Calendar, ShoppingCart, SlidersHorizontal, Sparkles as SparklesIcon,
  TrendingUp, Plus,
} from "lucide-react";
import type { PlannerSchedule } from "@/lib/diet-planner";

type Tab = "today" | "week" | "variety" | "grocery" | "assistant" | "preferences";

type Props = { schedules: PlannerSchedule[]; activeMealTypes: string[] };

const TABS: { id: Tab; label: string; icon: typeof Calendar }[] = [
  { id: "today", label: "Today", icon: Calendar },
  { id: "week", label: "Week", icon: CalendarDays },
  { id: "variety", label: "Variety", icon: TrendingUp },
  { id: "grocery", label: "Grocery", icon: ShoppingCart },
  { id: "assistant", label: "Assistant", icon: SparklesIcon },
  { id: "preferences", label: "Preferences", icon: SlidersHorizontal },
];

export function PlannerShell({ schedules, activeMealTypes }: Props) {
  const [tab, setTab] = useState<Tab>("today");
  const [manualOpen, setManualOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-heading text-3xl font-semibold tracking-tight">Diet Planner</h1>
            <Badge variant="outline" className="text-[10px]">AI-powered</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Never eat the same thing twice — rotate meals without losing the plot.
          </p>
        </div>
      </div>

      {/* Always-visible AI quick start */}
      <DietSuggest existingMealTypes={activeMealTypes as never} />

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-lg bg-muted/50 overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition shrink-0 ${
                active
                  ? "bg-background shadow-sm font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="size-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {tab === "today" && <TodayView schedules={schedules} />}
      {tab === "week" && <WeeklyPlanner schedules={schedules} />}
      {tab === "variety" && <VarietyInsights schedules={schedules} />}
      {tab === "grocery" && <GroceryList schedules={schedules} />}
      {tab === "assistant" && <AiMealAssistant />}
      {tab === "preferences" && <PreferencesPanel />}

      {/* Always-available manual add at the bottom */}
      <div className="pt-4 border-t">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Want to type in a meal yourself?</p>
          <Button variant="outline" size="sm" onClick={() => setManualOpen(!manualOpen)}>
            <Plus className="mr-1 size-3.5" />
            {manualOpen ? "Close" : "Add meal manually"}
          </Button>
        </div>
        {manualOpen && (
          <div className="mt-4">
            <DietForm />
          </div>
        )}
      </div>
    </div>
  );
}
