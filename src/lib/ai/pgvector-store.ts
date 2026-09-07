/**
 * pgvector Vector Store
 *
 * Implements the shared VectorStore interface on top of Postgres + pgvector.
 * Rows live in the `VectorEntry` table (see prisma/migrations/…_pgvector_store),
 * with a `namespace` column standing in for LanceDB's per-table separation.
 *
 * All access is via $queryRaw/$executeRaw because Prisma cannot generate types
 * for the `vector` column type.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { VectorStore, VectorRow, VectorSearchResult } from "./types";

function toVectorLiteral(vec: number[]): string {
  // pgvector accepts a bracketed list as an input literal: '[0.1,0.2,...]'
  return `[${vec.join(",")}]`;
}

export class PgvectorStore implements VectorStore {
  async upsert(namespace: string, rows: VectorRow[]): Promise<void> {
    if (rows.length === 0) return;

    // One INSERT ... ON CONFLICT per row. Prisma pools the connection so this
    // is fast enough for the batch sizes we use (100 rows/embed batch).
    for (const row of rows) {
      const embedding = toVectorLiteral(row.vector);
      const metadataJson = JSON.stringify(row.metadata ?? {});

      await prisma.$executeRaw`
        INSERT INTO "VectorEntry" ("id", "namespace", "text", "metadata", "embedding")
        VALUES (
          ${row.id},
          ${namespace},
          ${row.text},
          ${metadataJson}::jsonb,
          ${embedding}::vector
        )
        ON CONFLICT ("id") DO UPDATE SET
          "namespace" = EXCLUDED."namespace",
          "text"      = EXCLUDED."text",
          "metadata"  = EXCLUDED."metadata",
          "embedding" = EXCLUDED."embedding"
      `;
    }
  }

  async search(
    namespace: string,
    queryVector: number[],
    limit: number,
  ): Promise<VectorSearchResult[]> {
    const vecLit = toVectorLiteral(queryVector);

    // `<=>` is cosine distance in pgvector (0 identical, 2 opposite).
    // Return `1 - distance` as score so higher = better, matching LanceDB's shape.
    const rows = await prisma.$queryRaw<
      Array<{ id: string; text: string; metadata: unknown; distance: number }>
    >`
      SELECT
        "id",
        "text",
        "metadata",
        ("embedding" <=> ${vecLit}::vector) AS "distance"
      FROM "VectorEntry"
      WHERE "namespace" = ${namespace}
      ORDER BY "embedding" <=> ${vecLit}::vector
      LIMIT ${limit}
    `;

    return rows.map((r) => ({
      id: r.id,
      text: r.text,
      score: 1 - Number(r.distance),
      metadata: (r.metadata as Record<string, unknown> | null) ?? {},
    }));
  }

  async delete(namespace: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await prisma.$executeRaw`
      DELETE FROM "VectorEntry"
      WHERE "namespace" = ${namespace}
        AND "id" IN (${Prisma.join(ids)})
    `;
  }

  async dispose(): Promise<void> {
    // No connection to close — this store shares the app-wide Prisma client.
  }
}
