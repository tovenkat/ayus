import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { FileText, Clock } from "lucide-react";
import type { DocumentListItem } from "@/lib/wiki-queries";
import { extractSummary } from "@/lib/markdown-render";

interface DocumentCardProps {
  document: DocumentListItem;
}

export function DocumentCard({ document: doc }: DocumentCardProps) {
  const summary = doc.summary ?? extractSummary(doc.slug); // will use rawContent in list query
  const dateStr = doc.updatedAt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  return (
    <Link href={`/wiki/${doc.slug}`}>
      <Card className="h-full hover:bg-muted/50 transition-colors cursor-pointer">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-sm leading-tight line-clamp-2">
              {doc.title}
            </h3>
            <FileText className="size-4 text-muted-foreground shrink-0 mt-0.5" />
          </div>
        </CardHeader>
        <CardContent className="pt-0 space-y-2">
          {summary && (
            <p className="text-xs text-muted-foreground line-clamp-3">
              {summary}
            </p>
          )}
          <div className="flex items-center justify-between">
            <div className="flex flex-wrap gap-1">
              {doc.tags.slice(0, 3).map((tag) => (
                <Badge key={tag} variant="outline" className="text-[10px] px-1.5 py-0">
                  {tag}
                </Badge>
              ))}
              {doc.tags.length > 3 && (
                <span className="text-[10px] text-muted-foreground">
                  +{doc.tags.length - 3}
                </span>
              )}
            </div>
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
              <Clock className="size-3" />
              {dateStr}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
