import type { MealType } from "@prisma/client";

export type PlannerSchedule = {
  id: string;
  mealType: MealType;
  time: string;
  items: string;
  calories: number | null;
  notes: string | null;
  restrictions: string[];
  daysOfWeek: number[];
  active: boolean;
  imageUrl: string | null;
  cuisineTags: string[];
  prepMinutes: number | null;
  recipeUrl: string | null;
  locked: boolean;
  isFavorite: boolean;
  hidden: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const DAY_LABELS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const DEFAULT_DAYS = [0, 1, 2, 3, 4, 5, 6];

export const MEAL_TYPES: MealType[] = [
  "BREAKFAST",
  "MORNING_SNACK",
  "LUNCH",
  "AFTERNOON_SNACK",
  "DINNER",
  "EVENING_SNACK",
];

export const MEAL_LABEL: Record<MealType, string> = {
  BREAKFAST: "Breakfast",
  MORNING_SNACK: "Morning snack",
  LUNCH: "Lunch",
  AFTERNOON_SNACK: "Afternoon snack",
  DINNER: "Dinner",
  EVENING_SNACK: "Evening snack",
};

/** A meal applies to a day if daysOfWeek is empty (daily) or contains the day. */
export function mealAppliesToDay(meal: PlannerSchedule, day: number): boolean {
  return meal.daysOfWeek.length === 0 || meal.daysOfWeek.includes(day);
}

export function mealsForDay(schedules: PlannerSchedule[], day: number): PlannerSchedule[] {
  return schedules
    .filter((s) => mealAppliesToDay(s, day) && !s.hidden)
    .sort((a, b) => {
      // Favorites float above non-favorites within the same time; otherwise sort by time.
      if (a.time === b.time && a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
      return a.time.localeCompare(b.time);
    });
}

// ─── Ingredient tokenization ────────────────────────────────────────────────
//
// Very lightweight — the "items" field is freeform text like
// "2 ragi roti + 1 katori dal + 1 small bowl curd". We pull out the nouny
// phrases by stripping quantities, katori/bowl/cup/glass, and common stopwords.

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "with", "of", "to", "in", "on", "at", "by",
  "for", "plus", "from", "some", "one", "two", "three", "four", "five", "six",
  "half", "quarter", "little", "small", "medium", "large", "big", "tbsp", "tsp",
  "teaspoon", "tablespoon", "cup", "cups", "bowl", "bowls", "glass", "glasses",
  "piece", "pieces", "slice", "slices", "katori", "katoris", "katoris", "roti", "rotis",
  "chapati", "chapatis", "phulka", "phulkas",
]);

const NON_INGREDIENT_WORDS = new Set([
  "plain", "mixed", "steamed", "boiled", "grilled", "roasted", "fried", "baked",
  "fresh", "chopped", "sliced", "diced", "whole", "refined", "unrefined",
  "homemade", "breakfast", "lunch", "dinner", "snack", "morning", "evening",
  "meal", "meals", "food", "foods", "cuisine", "optional",
]);

export function tokenizeIngredients(items: string): string[] {
  const out: string[] = [];
  const pieces = items.split(/\s*[+,;•|]\s*|\s+and\s+|\s+or\s+/i).filter(Boolean);
  for (const piece of pieces) {
    const cleaned = piece
      .toLowerCase()
      // remove leading quantities: "2 ", "1.5 ", "1/2 ", "half a", "1x "
      .replace(/^(?:\d+(?:[./]\d+)?|half|one|two|three|four|five|six|seven|eight|nine|ten)\s*x?\s*/i, "")
      .replace(/\(.*?\)/g, "") // drop parentheticals
      .replace(/\b(?:grams?|g|ml|liters?|l|kg|oz|lbs?|tbsp|tsp)\b/gi, "")
      .replace(/[^a-z\s-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleaned) continue;
    // Keep noun-like phrases only; drop words in stopword lists
    const words = cleaned.split(" ").filter((w) => {
      if (!w) return false;
      if (w.length <= 1) return false;
      if (STOPWORDS.has(w)) return false;
      if (NON_INGREDIENT_WORDS.has(w)) return false;
      return true;
    });
    if (words.length === 0) continue;
    out.push(words.join(" ").trim());
  }
  return out.filter((s) => s.length > 2);
}

// ─── Variety score ──────────────────────────────────────────────────────────
//
// Treat each ingredient phrase as a unit. A week with high diversity scores
// closer to 100. A week with the same breakfast all 7 days scores low.

export type VarietyStats = {
  score: number; // 0-100
  totalMealsPerWeek: number;
  uniqueIngredients: number;
  repeatedIngredients: { name: string; count: number }[];
  mostRepeatedMeal: { items: string; daysApplied: number } | null;
};

export function computeVariety(schedules: PlannerSchedule[]): VarietyStats {
  const active = schedules.filter((s) => s.active);
  if (active.length === 0) {
    return { score: 0, totalMealsPerWeek: 0, uniqueIngredients: 0, repeatedIngredients: [], mostRepeatedMeal: null };
  }

  // Expand by days-applied to represent actual weekly servings
  type Expanded = { meal: PlannerSchedule; ingredients: string[] };
  const expanded: Expanded[] = [];
  const mealServings = new Map<string, number>(); // items → days it appears

  for (const s of active) {
    const days = s.daysOfWeek.length === 0 ? DEFAULT_DAYS.length : s.daysOfWeek.length;
    const ings = tokenizeIngredients(s.items);
    for (let i = 0; i < days; i++) expanded.push({ meal: s, ingredients: ings });
    mealServings.set(s.items, (mealServings.get(s.items) ?? 0) + days);
  }

  const ingredientCounts = new Map<string, number>();
  for (const e of expanded) {
    for (const ing of e.ingredients) {
      ingredientCounts.set(ing, (ingredientCounts.get(ing) ?? 0) + 1);
    }
  }

  const totalMealsPerWeek = expanded.length;
  const uniqueIngredients = ingredientCounts.size;

  // Score: ratio of unique ingredients to total servings, mapped to 0-100.
  // Cap because realistically you WILL have dal or curd several times/week.
  const rawRatio = totalMealsPerWeek > 0 ? uniqueIngredients / (totalMealsPerWeek * 2) : 0;
  const score = Math.round(Math.max(0, Math.min(1, rawRatio * 1.4)) * 100);

  const repeatedIngredients = Array.from(ingredientCounts.entries())
    .filter(([, c]) => c >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => ({ name, count }));

  const mostRepeatedMealEntry = Array.from(mealServings.entries()).sort((a, b) => b[1] - a[1])[0];
  const mostRepeatedMeal = mostRepeatedMealEntry && mostRepeatedMealEntry[1] >= 3
    ? { items: mostRepeatedMealEntry[0], daysApplied: mostRepeatedMealEntry[1] }
    : null;

  return { score, totalMealsPerWeek, uniqueIngredients, repeatedIngredients, mostRepeatedMeal };
}

// ─── Grocery list ───────────────────────────────────────────────────────────

export const GROCERY_CATEGORIES = [
  "vegetables", "fruits", "dairy", "protein", "grains", "spices", "pantry", "other",
] as const;
export type GroceryCategory = typeof GROCERY_CATEGORIES[number];

// Heuristic keyword → category dictionary. Not exhaustive; anything unmatched
// falls into "other" — the UI shows this bucket so users can eyeball what's
// escaping the classifier. Curate additions as they appear.
const CATEGORY_KEYWORDS: Record<GroceryCategory, string[]> = {
  vegetables: ["tomato", "onion", "potato", "carrot", "spinach", "palak", "methi", "beans", "cabbage", "cauliflower", "gobi", "brinjal", "baingan", "bhindi", "okra", "capsicum", "pepper", "lauki", "bottle gourd", "cucumber", "kheera", "beetroot", "radish", "mooli", "peas", "matar", "corn", "broccoli", "mushroom", "lettuce", "greens", "leafy", "vegetables", "veggies"],
  fruits:     ["apple", "banana", "orange", "papaya", "guava", "pomegranate", "watermelon", "mango", "grapes", "pineapple", "berries", "strawberry", "blueberry", "kiwi", "pear", "lime", "lemon", "amla", "coconut", "fruit", "fruits"],
  dairy:      ["milk", "curd", "yogurt", "dahi", "butter", "ghee", "cheese", "paneer", "cream", "buttermilk", "chaas", "lassi", "khoya"],
  protein:    ["chicken", "mutton", "fish", "prawn", "shrimp", "egg", "eggs", "tofu", "soya", "dal", "lentil", "chickpea", "chana", "rajma", "kidney bean", "moong", "urad", "toor", "arhar", "masoor", "sprouts", "beans", "nuts", "almond", "walnut", "cashew", "kaju", "badam", "peanut"],
  grains:     ["rice", "chawal", "roti", "chapati", "phulka", "wheat", "atta", "flour", "besan", "bread", "oats", "poha", "upma", "sooji", "rava", "millet", "ragi", "bajra", "jowar", "quinoa", "pasta", "noodles", "vermicelli", "sevai", "dosa", "idli", "batter"],
  spices:     ["salt", "sugar", "jaggery", "gud", "turmeric", "haldi", "chili", "mirch", "cumin", "jeera", "coriander", "dhania", "mustard", "rai", "asafoetida", "hing", "garam masala", "cardamom", "elaichi", "cinnamon", "dalchini", "clove", "laung", "bay leaf", "tej patta", "ginger", "adrak", "garlic", "lehsun", "curry leaves"],
  pantry:     ["oil", "vinegar", "sauce", "ketchup", "soy sauce", "honey", "tea", "coffee", "biscuit", "cookie", "namkeen", "papad", "pickle", "achaar", "chutney"],
  other:      [],
};

function classifyIngredient(name: string): GroceryCategory {
  const n = name.toLowerCase();
  for (const cat of GROCERY_CATEGORIES) {
    if (cat === "other") continue;
    if (CATEGORY_KEYWORDS[cat].some((kw) => n.includes(kw))) return cat;
  }
  return "other";
}

export type GroceryItem = {
  name: string;
  occurrencesPerWeek: number;
  category: GroceryCategory;
};

export function buildGroceryList(schedules: PlannerSchedule[]): GroceryItem[] {
  const counts = new Map<string, number>();
  for (const s of schedules.filter((x) => x.active && !x.hidden)) {
    const days = s.daysOfWeek.length === 0 ? DEFAULT_DAYS.length : s.daysOfWeek.length;
    for (const ing of tokenizeIngredients(s.items)) {
      counts.set(ing, (counts.get(ing) ?? 0) + days);
    }
  }
  return Array.from(counts.entries())
    .map(([name, occurrencesPerWeek]) => ({
      name,
      occurrencesPerWeek,
      category: classifyIngredient(name),
    }))
    .sort((a, b) => b.occurrencesPerWeek - a.occurrencesPerWeek);
}

/** Group grocery items by category, preserving in-category sort order. */
export function groupGroceryByCategory(items: GroceryItem[]): Record<GroceryCategory, GroceryItem[]> {
  const groups = Object.fromEntries(GROCERY_CATEGORIES.map((c) => [c, [] as GroceryItem[]])) as Record<GroceryCategory, GroceryItem[]>;
  for (const item of items) groups[item.category].push(item);
  return groups;
}

export const GROCERY_CATEGORY_LABEL: Record<GroceryCategory, string> = {
  vegetables: "Vegetables",
  fruits: "Fruits",
  dairy: "Dairy",
  protein: "Protein",
  grains: "Grains",
  spices: "Spices",
  pantry: "Pantry",
  other: "Other",
};
