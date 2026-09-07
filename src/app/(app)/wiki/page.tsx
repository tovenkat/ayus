import { requireAuth } from "@/lib/auth-helpers";
import { listDocuments, listTags } from "@/lib/wiki-queries";
import { DocumentCard } from "@/components/wiki/document-card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { BookOpen, Tags } from "lucide-react";

export const metadata = { title: "Health Notes — Ayus" };

export default async function WikiPage({
  searchParams,
}: {
  searchParams: Promise<{ tag?: string; q?: string }>;
}) {
  const userId = await requireAuth();
  const params = await searchParams;
  const tag = params.tag;
  const search = params.q;

  const [{ documents, total }, tags] = await Promise.all([
    listDocuments(userId, { tag, search }),
    listTags(userId),
  ]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-3xl font-semibold tracking-tight">Health Notes</h1>
          <p className="text-sm text-muted-foreground">
            {total} document{total !== 1 ? "s" : ""}
            {tag && (
              <>
                {" "}tagged{" "}
                <Badge variant="secondary" className="text-xs">
                  #{tag}
                </Badge>
              </>
            )}
            {search && <> matching &quot;{search}&quot;</>}
          </p>
        </div>
      </div>

      {/* Tag filter bar */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <Link href="/wiki">
            <Badge
              variant={!tag ? "default" : "outline"}
              className="text-xs cursor-pointer"
            >
              All
            </Badge>
          </Link>
          {tags.slice(0, 20).map((t) => (
            <Link key={t.name} href={`/wiki?tag=${encodeURIComponent(t.name)}`}>
              <Badge
                variant={tag === t.name ? "default" : "outline"}
                className="text-xs cursor-pointer"
              >
                #{t.name}
                <span className="ml-1 opacity-60">{t.count}</span>
              </Badge>
            </Link>
          ))}
          {tags.length > 20 && (
            <Link href="/tags">
              <Badge variant="outline" className="text-xs cursor-pointer">
                <Tags className="size-3 mr-1" />
                All tags
              </Badge>
            </Link>
          )}
        </div>
      )}

      {/* Document grid */}
      {documents.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {documents.map((doc) => (
            <DocumentCard key={doc.id} document={doc} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <BookOpen className="size-12 text-muted-foreground/40 mb-4" />
          <h2 className="text-lg font-medium">No health notes yet</h2>
          <p className="text-sm text-muted-foreground mt-1">
            <Link href="/upload" className="text-primary hover:underline">
              Upload your health documents
            </Link>{" "}
            to get started.
          </p>
        </div>
      )}
    </div>
  );
}
