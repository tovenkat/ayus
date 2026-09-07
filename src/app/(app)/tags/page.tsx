import { requireAuth } from "@/lib/auth-helpers";
import { listTags } from "@/lib/wiki-queries";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Tags } from "lucide-react";

export const metadata = { title: "Tags — Ayus" };

export default async function TagsPage() {
  const userId = await requireAuth();
  const tags = await listTags(userId);

  // Calculate font size based on count (tag cloud effect)
  const maxCount = Math.max(...tags.map((t) => t.count), 1);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">Tags</h1>
        <p className="text-sm text-muted-foreground">
          {tags.length} tag{tags.length !== 1 ? "s" : ""} across your wiki
        </p>
      </div>

      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => {
            const scale = 0.75 + (tag.count / maxCount) * 0.5; // 0.75x to 1.25x
            return (
              <Link
                key={tag.name}
                href={`/wiki?tag=${encodeURIComponent(tag.name)}`}
              >
                <Badge
                  variant="outline"
                  className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors"
                  style={{ fontSize: `${scale}rem` }}
                >
                  #{tag.name}
                  <span className="ml-1.5 opacity-50">{tag.count}</span>
                </Badge>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Tags className="size-12 text-muted-foreground/40 mb-4" />
          <h2 className="text-lg font-medium">No tags yet</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Tags are extracted from #hashtags and YAML frontmatter in your documents.
          </p>
        </div>
      )}
    </div>
  );
}
