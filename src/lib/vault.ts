import { promises as fs } from "node:fs";
import path from "node:path";

function getVaultRoot(): string {
  return process.env.VAULT_ROOT ?? path.join(process.cwd(), "phr2");
}

function userScope(userId: string): string {
  return path.join(getVaultRoot(), userId);
}

async function writeFile(absPath: string, data: Buffer | string): Promise<void> {
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  await fs.writeFile(absPath, data);
}

export async function writeWikiPage(userId: string, relPath: string, content: string): Promise<void> {
  const abs = path.join(userScope(userId), "wiki", relPath);
  await writeFile(abs, content);
}

export async function readWikiPage(userId: string, relPath: string): Promise<string | null> {
  const abs = path.join(userScope(userId), "wiki", relPath);
  try {
    return await fs.readFile(abs, "utf8");
  } catch {
    return null;
  }
}

export async function copyToRaw(userId: string, filename: string, buffer: Buffer): Promise<void> {
  const abs = path.join(userScope(userId), "raw", filename);
  await writeFile(abs, buffer);
}

export async function appendLog(userId: string, line: string): Promise<void> {
  const abs = path.join(userScope(userId), "wiki", "log.md");
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const exists = await fs.stat(abs).then(() => true).catch(() => false);
  if (!exists) {
    await fs.writeFile(abs, "# Log\n\nAppend-only record of all operations on this vault.\n\n");
  }
  const stamp = new Date().toISOString();
  await fs.appendFile(abs, `- ${stamp} — ${line}\n`);
}

export function safeFileName(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "file";
}

/**
 * Seed a new user's vault with:
 *  - CLAUDE.md   (copy of the template at the repo's phr2/ root)
 *  - wiki/index.md and wiki/log.md (placeholders)
 * Idempotent — won't overwrite existing files.
 */
export async function seedVault(userId: string): Promise<void> {
  const scope = userScope(userId);
  await fs.mkdir(path.join(scope, "raw"), { recursive: true });
  await fs.mkdir(path.join(scope, "wiki"), { recursive: true });

  // Copy CLAUDE.md from the repo template at phr2/CLAUDE.md (VAULT_ROOT)
  const templatePath = path.join(getVaultRoot(), "CLAUDE.md");
  const destClaudeMd = path.join(scope, "CLAUDE.md");
  try {
    const existing = await fs.stat(destClaudeMd).then(() => true).catch(() => false);
    if (!existing) {
      const template = await fs.readFile(templatePath, "utf8");
      await fs.writeFile(destClaudeMd, template);
    }
  } catch {
    // template missing — skip
  }

  // Placeholder index + log if missing
  const indexPath = path.join(scope, "wiki", "index.md");
  const indexExists = await fs.stat(indexPath).then(() => true).catch(() => false);
  if (!indexExists) {
    await fs.writeFile(
      indexPath,
      `---\ntitle: Health Index\ntags: [index]\ntype: master-index\n---\n\n# Health Index\n\nYour personal health record timeline and entity index.\nThis page is auto-regenerated — upload a lab report to get started.\n`,
    );
  }
  const logPath = path.join(scope, "wiki", "log.md");
  const logExists = await fs.stat(logPath).then(() => true).catch(() => false);
  if (!logExists) {
    const stamp = new Date().toISOString();
    await fs.writeFile(
      logPath,
      `# Log\n\nAppend-only record of all operations on this vault.\n\n- ${stamp} — vault seeded for user ${userId}\n`,
    );
  }
}
