"use client";

import { toggleDietSchedule, deleteDietSchedule } from "@/lib/actions/health";
import { Button } from "@/components/ui/button";
import { Pause, Play, Trash2 } from "lucide-react";

export function DietActions({ id, active }: { id: string; active: boolean }) {
  return (
    <div className="flex gap-1">
      <Button
        variant="ghost" size="icon" className="size-7"
        onClick={() => toggleDietSchedule(id, !active)}
        title={active ? "Pause" : "Resume"}
      >
        {active ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
      </Button>
      <Button
        variant="ghost" size="icon" className="size-7 text-destructive"
        onClick={() => deleteDietSchedule(id)}
        title="Delete"
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
}
