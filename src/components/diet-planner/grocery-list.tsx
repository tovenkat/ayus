"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ShoppingCart, Copy, Check, Plus, Carrot, Apple, Milk, Drumstick, Wheat, Flame, Package, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import {
  buildGroceryList, groupGroceryByCategory,
  GROCERY_CATEGORIES, GROCERY_CATEGORY_LABEL,
  type GroceryCategory, type PlannerSchedule,
} from "@/lib/diet-planner";

const CATEGORY_ICON: Record<GroceryCategory, typeof Carrot> = {
  vegetables: Carrot,
  fruits: Apple,
  dairy: Milk,
  protein: Drumstick,
  grains: Wheat,
  spices: Flame,
  pantry: Package,
  other: MoreHorizontal,
};

type Props = { schedules: PlannerSchedule[] };

export function GroceryList({ schedules }: Props) {
  const items = useMemo(() => buildGroceryList(schedules), [schedules]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [extras, setExtras] = useState<Array<{ name: string; category: GroceryCategory }>>([]);
  const [newItem, setNewItem] = useState("");

  const grouped = useMemo(() => {
    const base = groupGroceryByCategory(items);
    // Merge user-added extras — placed at the top of each category, marked
    // with occurrencesPerWeek=0 so they render as "you added this."
    for (const extra of extras) {
      base[extra.category].unshift({ name: extra.name, occurrencesPerWeek: 0, category: extra.category });
    }
    return base;
  }, [items, extras]);

  function toggle(name: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function addExtra() {
    const name = newItem.trim().toLowerCase();
    if (!name) return;
    if (extras.some((e) => e.name === name) || items.some((i) => i.name === name)) {
      toast.info(`"${name}" is already in the list`);
      setNewItem("");
      return;
    }
    // Classify with the same map so it lands in the right category.
    setExtras((prev) => [...prev, { name, category: guessCategoryLocally(name) }]);
    setNewItem("");
  }

  function copyList() {
    const lines: string[] = [];
    for (const cat of GROCERY_CATEGORIES) {
      const rows = grouped[cat];
      if (rows.length === 0) continue;
      lines.push(`## ${GROCERY_CATEGORY_LABEL[cat]}`);
      for (const r of rows) {
        lines.push(`- ${r.name}${r.occurrencesPerWeek > 0 ? `  (${r.occurrencesPerWeek}×/week)` : ""}`);
      }
      lines.push("");
    }
    navigator.clipboard.writeText(lines.join("\n").trim());
    toast.success("Grocery list copied.");
  }

  const totalItems = items.length + extras.length;

  if (totalItems === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center space-y-3">
          <ShoppingCart className="size-8 mx-auto text-muted-foreground/40" />
          <div className="space-y-1">
            <p className="font-medium">Nothing to shop for</p>
            <p className="text-xs text-muted-foreground">Add meals to your plan and we&apos;ll aggregate the ingredients here.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <ShoppingCart className="size-4 text-primary" />
          <h2 className="text-lg font-heading font-semibold">Grocery list</h2>
          <Badge variant="outline" className="text-[10px]">{totalItems} items</Badge>
        </div>
        <Button variant="outline" size="sm" onClick={copyList}>
          <Copy className="mr-2 size-3.5" />Copy
        </Button>
      </div>

      {/* Add missing items */}
      <Card>
        <CardContent className="py-3">
          <div className="flex items-center gap-2">
            <Input
              placeholder="Add missing item — e.g. tofu, avocado, curry leaves"
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addExtra(); } }}
              className="flex-1"
            />
            <Button size="sm" variant="outline" onClick={addExtra} disabled={!newItem.trim()}>
              <Plus className="size-3.5 mr-1" />Add
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Categories */}
      {GROCERY_CATEGORIES.map((cat) => {
        const rows = grouped[cat];
        if (rows.length === 0) return null;
        const CatIcon = CATEGORY_ICON[cat];
        return (
          <Card key={cat}>
            <CardContent className="py-4 space-y-2">
              <div className="flex items-center gap-2">
                <CatIcon className="size-3.5 text-muted-foreground" />
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
                  {GROCERY_CATEGORY_LABEL[cat]}
                </div>
                <Badge variant="outline" className="text-[10px] ml-auto">{rows.length}</Badge>
              </div>
              <ul className="divide-y -my-1">
                {rows.map((i) => (
                  <li key={i.name} className="py-2 flex items-center gap-3">
                    <Checkbox
                      checked={checked.has(i.name)}
                      onCheckedChange={() => toggle(i.name)}
                    />
                    <span className={`text-sm capitalize flex-1 ${checked.has(i.name) ? "line-through text-muted-foreground" : ""}`}>
                      {i.name}
                    </span>
                    {i.occurrencesPerWeek > 0 ? (
                      <Badge variant={i.occurrencesPerWeek >= 4 ? "secondary" : "outline"} className="text-[10px]">
                        {i.occurrencesPerWeek}×/wk
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] text-primary border-primary/40">added</Badge>
                    )}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        );
      })}

      {checked.size > 0 && (
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Check className="size-3.5 text-emerald-600" />
          {checked.size} item{checked.size === 1 ? "" : "s"} checked off
        </div>
      )}
    </div>
  );
}

// Client-side quick classifier — matches the server-side keyword list on a
// smaller vocabulary. Extras rarely land in the wrong bucket; user can add
// a second time if needed. Kept out of the shared lib to avoid re-exporting
// the full keyword dict to the browser.
function guessCategoryLocally(name: string): GroceryCategory {
  const n = name.toLowerCase();
  if (/tomato|onion|potato|carrot|spinach|broccoli|cabbage|lettuce|pepper|cucumber|beetroot|okra|bhindi|methi|palak|greens|veg/.test(n)) return "vegetables";
  if (/apple|banana|orange|grape|berry|mango|papaya|guava|melon|kiwi|pear|lime|lemon|fruit|coconut/.test(n)) return "fruits";
  if (/milk|curd|yogurt|dahi|butter|ghee|cheese|paneer|cream/.test(n)) return "dairy";
  if (/chicken|mutton|fish|prawn|egg|tofu|dal|lentil|chickpea|chana|rajma|moong|nuts|almond|cashew|walnut|peanut/.test(n)) return "protein";
  if (/rice|roti|chapati|wheat|atta|flour|bread|oats|poha|upma|rava|millet|ragi|bajra|jowar|quinoa|pasta|noodle/.test(n)) return "grains";
  if (/salt|sugar|jaggery|turmeric|haldi|chili|mirch|cumin|jeera|coriander|dhania|mustard|cardamom|cinnamon|clove|garlic|ginger|masala/.test(n)) return "spices";
  if (/oil|vinegar|sauce|ketchup|honey|tea|coffee|biscuit|pickle|chutney|papad/.test(n)) return "pantry";
  return "other";
}
