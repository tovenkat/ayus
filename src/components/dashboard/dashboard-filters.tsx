"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

interface DashboardFiltersProps {
  categories: string[];
}

export function DashboardFilters({ categories }: DashboardFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const range = searchParams.get("range") ?? "all";
  const category = searchParams.get("category") ?? "";
  const abnormalOnly = searchParams.get("abnormalOnly") === "true";
  const worseningOnly = searchParams.get("worseningOnly") === "true";
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";

  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === "") {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }
      router.push(`/dashboard?${params.toString()}`);
    },
    [router, searchParams]
  );

  return (
    <div className="flex flex-wrap items-center gap-4">
      <Tabs
        value={range}
        onValueChange={(v) =>
          updateParams({
            range: v,
            ...(v !== "custom" ? { from: null, to: null } : {}),
          })
        }
      >
        <TabsList>
          <TabsTrigger value="30">30d</TabsTrigger>
          <TabsTrigger value="90">90d</TabsTrigger>
          <TabsTrigger value="365">1y</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="custom">Custom</TabsTrigger>
        </TabsList>
      </Tabs>

      {range === "custom" && (
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={from}
            onChange={(e) => updateParams({ from: e.target.value })}
            className="h-9 w-36"
          />
          <span className="text-muted-foreground text-sm">to</span>
          <Input
            type="date"
            value={to}
            onChange={(e) => updateParams({ to: e.target.value })}
            className="h-9 w-36"
          />
        </div>
      )}

      {categories.length > 0 && (
        <Select
          value={category || "all"}
          onValueChange={(v) =>
            updateParams({ category: v === "all" ? null : v })
          }
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <div className="flex items-center gap-2">
        <Checkbox
          id="abnormal-only"
          checked={abnormalOnly}
          onCheckedChange={(checked) =>
            updateParams({ abnormalOnly: checked ? "true" : null })
          }
        />
        <Label htmlFor="abnormal-only" className="text-sm cursor-pointer">
          Abnormal only
        </Label>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="worsening-only"
          checked={worseningOnly}
          onCheckedChange={(checked) =>
            updateParams({ worseningOnly: checked ? "true" : null })
          }
        />
        <Label htmlFor="worsening-only" className="text-sm cursor-pointer">
          Worsening
        </Label>
      </div>
    </div>
  );
}
