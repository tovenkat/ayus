"use client";

import { AlertTriangle, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { Card, CardContent } from "@/components/ui/card";

const CATEGORIES = [
  {
    key: "outOfRange" as const,
    label: "Out of Range",
    color: "#ef4444",
    icon: AlertTriangle,
    iconColor: "text-red-500",
    activeBg: "bg-red-50 dark:bg-red-950/40",
    activeBorder: "border-red-300 dark:border-red-800",
  },
  {
    key: "improving" as const,
    label: "Improving",
    color: "#10b981",
    icon: TrendingDown,
    iconColor: "text-emerald-500",
    activeBg: "bg-emerald-50 dark:bg-emerald-950/40",
    activeBorder: "border-emerald-300 dark:border-emerald-800",
  },
  {
    key: "worsening" as const,
    label: "Worsening",
    color: "#f59e0b",
    icon: TrendingUp,
    iconColor: "text-amber-500",
    activeBg: "bg-amber-50 dark:bg-amber-950/40",
    activeBorder: "border-amber-300 dark:border-amber-800",
  },
  {
    key: "stable" as const,
    label: "Stable",
    color: "#3b82f6",
    icon: Minus,
    iconColor: "text-blue-500",
    activeBg: "bg-blue-50 dark:bg-blue-950/40",
    activeBorder: "border-blue-300 dark:border-blue-800",
  },
] as const;

type CategoryKey = (typeof CATEGORIES)[number]["key"];

interface HealthOverviewProps {
  summary: {
    outOfRange: string[];
    improving: string[];
    worsening: string[];
    stable: string[];
  };
  selected: CategoryKey | null;
  onSelect: (key: CategoryKey | null) => void;
}

export function HealthOverview({ summary, selected, onSelect }: HealthOverviewProps) {
  const counts: Record<CategoryKey, number> = {
    outOfRange: summary.outOfRange.length,
    improving: summary.improving.length,
    worsening: summary.worsening.length,
    stable: summary.stable.length,
  };

  const totalTests = counts.improving + counts.worsening + counts.stable;

  const pieData = CATEGORIES.map((cat) => ({
    name: cat.label,
    value: counts[cat.key],
    color: cat.color,
    key: cat.key,
  })).filter((d) => d.value > 0);

  if (pieData.length === 0) return null;

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="flex flex-col">
          {/* Donut — click to clear selection */}
          <button
            className="relative flex items-center justify-center px-6 pt-5 pb-2 w-full"
            onClick={() => onSelect(null)}
            title="Show all tests"
          >
            <ResponsiveContainer width="100%" height={150}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={44}
                  outerRadius={68}
                  paddingAngle={2}
                  dataKey="value"
                  isAnimationActive={false}
                  stroke="none"
                >
                  {pieData.map((entry) => (
                    <Cell
                      key={entry.name}
                      fill={entry.color}
                      opacity={selected && selected !== entry.key ? 0.3 : 1}
                    />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            {/* Center label */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-2xl font-bold leading-none">{totalTests}</span>
              <span className="text-[10px] text-muted-foreground mt-0.5">
                {selected ? "click to reset" : "total tests"}
              </span>
            </div>
          </button>

          {/* Stat row — 4 columns below the donut */}
          <div className="grid grid-cols-4 divide-x border-t">
            {CATEGORIES.map((cat) => {
              const count = counts[cat.key];
              const Icon = cat.icon;
              const isActive = selected === cat.key;
              return (
                <button
                  key={cat.key}
                  onClick={() => onSelect(isActive ? null : cat.key)}
                  disabled={count === 0}
                  className={`
                    flex flex-col items-center justify-center gap-1 py-3 text-center
                    transition-all duration-150 relative
                    ${count > 0 ? "cursor-pointer" : "opacity-35 cursor-default"}
                    ${isActive ? `${cat.activeBg}` : "hover:bg-muted/50"}
                  `}
                >
                  {isActive && (
                    <span
                      className="absolute top-0 inset-x-0 h-0.5"
                      style={{ backgroundColor: cat.color }}
                    />
                  )}
                  <Icon className={`h-3.5 w-3.5 ${cat.iconColor}`} />
                  <span
                    className="text-xl font-bold leading-none tabular-nums"
                    style={isActive ? { color: cat.color } : undefined}
                  >
                    {count}
                  </span>
                  <span className="text-[10px] text-muted-foreground leading-tight px-1">
                    {cat.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
