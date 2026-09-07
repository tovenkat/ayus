/**
 * LanceDB Vector Store
 *
 * Stores embeddings in a local LanceDB database for semantic search.
 * Singleton connection managed by the vector-store factory.
 */

import type { VectorStore, VectorRow, VectorSearchResult } from "./types";

type LanceDBConnection = Awaited<ReturnType<typeof import("@lancedb/lancedb").connect>>;
type LanceDBTable = Awaited<ReturnType<LanceDBConnection["openTable"]>>;

/** Simple async mutex to serialize LanceDB writes (it only allows one at a time). */
class WriteMutex {
  private queue: Promise<void> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    // Keep the chain going regardless of success/failure
    this.queue = next.then(() => {}, () => {});
    return next;
  }
}

export class LanceDBStore implements VectorStore {
  private dbPath: string;
  private db: LanceDBConnection | null = null;
  private tables = new Map<string, LanceDBTable>();
  private loadPromise: Promise<void> | null = null;
  private writeMutex = new WriteMutex();

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  private async ensureConnected(): Promise<void> {
    if (this.db) return;

    if (!this.loadPromise) {
      this.loadPromise = this.connect();
    }

    return this.loadPromise;
  }

  private async connect(): Promise<void> {
    const lancedb = await import("@lancedb/lancedb");
    this.db = await lancedb.connect(this.dbPath);
    console.log(`[lancedb] Connected to ${this.dbPath}`);
  }

  private async getOrCreateTable(
    name: string,
    sampleRow?: VectorRow
  ): Promise<LanceDBTable> {
    await this.ensureConnected();

    let table = this.tables.get(name);
    if (table) return table;

    // Try opening existing table
    try {
      const tableNames = await this.db!.tableNames();
      if (tableNames.includes(name)) {
        table = await this.db!.openTable(name);
        this.tables.set(name, table);
        return table;
      }
    } catch {
      // Table doesn't exist yet
    }

    // Create new table with sample data
    if (!sampleRow) {
      throw new Error(`Table "${name}" does not exist and no sample row provided`);
    }

    table = await this.db!.createTable(name, [
      {
        id: sampleRow.id,
        vector: sampleRow.vector,
        text: sampleRow.text,
        metadata: JSON.stringify(sampleRow.metadata),
      },
    ]);

    this.tables.set(name, table);
    return table;
  }

  async upsert(tableName: string, rows: VectorRow[]): Promise<void> {
    if (rows.length === 0) return;

    await this.writeMutex.run(async () => {
      const table = await this.getOrCreateTable(tableName, rows[0]);

      // LanceDB add (append) — for true upsert we'd need merge, but append is
      // simpler and works for our use case (dedup happens at query time)
      const data = rows.map((r) => ({
        id: r.id,
        vector: r.vector,
        text: r.text,
        metadata: JSON.stringify(r.metadata),
      }));

      await table.add(data);
    });
  }

  async search(
    tableName: string,
    queryVector: number[],
    limit: number
  ): Promise<VectorSearchResult[]> {
    await this.ensureConnected();

    let table: LanceDBTable;
    try {
      const tableNames = await this.db!.tableNames();
      if (!tableNames.includes(tableName)) {
        return [];
      }
      table = await this.db!.openTable(tableName);
    } catch {
      return [];
    }

    const results = await table
      .vectorSearch(queryVector)
      .limit(limit)
      .toArray();

    return results.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      text: r.text as string,
      score: r._distance != null ? 1 - (r._distance as number) : 0,
      metadata: r.metadata
        ? (JSON.parse(r.metadata as string) as Record<string, unknown>)
        : {},
    }));
  }

  async delete(tableName: string, ids: string[]): Promise<void> {
    await this.writeMutex.run(async () => {
      await this.ensureConnected();

      try {
        const tableNames = await this.db!.tableNames();
        if (!tableNames.includes(tableName)) return;
        const table = await this.db!.openTable(tableName);

        const filter = ids.map((id) => `id = '${id}'`).join(" OR ");
        await table.delete(filter);
      } catch (err) {
        console.warn("[lancedb] Delete failed:", err instanceof Error ? err.message : err);
      }
    });
  }

  async dispose(): Promise<void> {
    this.tables.clear();
    this.db = null;
    this.loadPromise = null;
    console.log("[lancedb] Disconnected");
  }
}
