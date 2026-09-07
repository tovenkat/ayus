import path from "node:path";
import { promises as fs } from "node:fs";
import chokidar from "chokidar";
import { prisma } from "@/lib/prisma";
import { indexFileFromDisk, pathToSlug } from "@/lib/vault-reconcile";
import { embedPendingChunks } from "@/lib/ingestion/pipeline";

function getVaultRoot(): string {
  return process.env.VAULT_ROOT ?? path.join(process.cwd(), "phr2");
}

let started = false;
const pendingTimers = new Map<string, NodeJS.Timeout>();
const pendingEmbed = new Set<string>();
let embedTimer: NodeJS.Timeout | null = null;

function debounceEmbed(userId: string) {
  pendingEmbed.add(userId);
  if (embedTimer) return;
  embedTimer = setTimeout(async () => {
    embedTimer = null;
    const users = Array.from(pendingEmbed);
    pendingEmbed.clear();
    for (const uid of users) {
      try {
        let batch = await embedPendingChunks(uid);
        while (batch > 0) batch = await embedPendingChunks(uid);
      } catch (err) {
        console.warn(`[vault-watcher] embed failed for ${uid}:`, err instanceof Error ? err.message : err);
      }
    }
  }, 2000);
}

function parseVaultPath(absPath: string): { userId: string; relPath: string } | null {
  const root = getVaultRoot();
  const rel = path.relative(root, absPath);
  if (rel.startsWith("..")) return null;
  const parts = rel.split(path.sep);
  if (parts.length < 3 || parts[1] !== "wiki") return null;
  if (!parts[parts.length - 1].toLowerCase().endsWith(".md")) return null;
  const userId = parts[0];
  const relPath = parts.slice(2).join("/");
  return { userId, relPath };
}

function scheduleIndex(absPath: string) {
  const parsed = parseVaultPath(absPath);
  if (!parsed) return;
  const key = absPath;
  const existing = pendingTimers.get(key);
  if (existing) clearTimeout(existing);
  pendingTimers.set(
    key,
    setTimeout(async () => {
      pendingTimers.delete(key);
      try {
        await indexFileFromDisk(parsed.userId, parsed.relPath);
        console.log(`[vault-watcher] indexed ${parsed.userId}/${parsed.relPath}`);
        debounceEmbed(parsed.userId);
      } catch (err) {
        console.warn(`[vault-watcher] index failed for ${parsed.relPath}:`, err instanceof Error ? err.message : err);
      }
    }, 250),
  );
}

async function handleDelete(absPath: string) {
  const parsed = parseVaultPath(absPath);
  if (!parsed) return;
  const slug = pathToSlug(parsed.relPath);
  await prisma.document.deleteMany({ where: { userId: parsed.userId, slug } });
  console.log(`[vault-watcher] deleted ${parsed.userId}/${parsed.relPath}`);
}

export function startVaultWatcher() {
  if (started) return;
  started = true;

  const root = getVaultRoot();
  fs.mkdir(root, { recursive: true }).catch(() => {});

  const watcher = chokidar.watch(root, {
    ignored: (p) => p.includes("/.obsidian/") || p.includes("/raw/"),
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    persistent: true,
  });

  watcher
    .on("add", scheduleIndex)
    .on("change", scheduleIndex)
    .on("unlink", handleDelete)
    .on("error", (err) => console.warn("[vault-watcher] error:", err));

  console.log(`[vault-watcher] watching ${root}`);
}
