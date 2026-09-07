import { NextResponse } from "next/server";

interface RateLimitEntry {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, RateLimitEntry>();

const CLEANUP_INTERVAL = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  const staleThreshold = now - 2 * 60 * 1000;
  for (const [key, entry] of buckets) {
    if (entry.lastRefill < staleThreshold) buckets.delete(key);
  }
}

export function consumeToken(key: string, maxTokens: number, refillRate: number): boolean {
  cleanup();
  const now = Date.now();
  let entry = buckets.get(key);

  if (!entry) {
    entry = { tokens: maxTokens - 1, lastRefill: now };
    buckets.set(key, entry);
    return true;
  }

  const elapsed = (now - entry.lastRefill) / 1000;
  entry.tokens = Math.min(maxTokens, entry.tokens + elapsed * refillRate);
  entry.lastRefill = now;

  if (entry.tokens < 1) return false;
  entry.tokens -= 1;
  return true;
}

export function checkApiRateLimit(
  userId: string,
  maxTokens: number = 60,
  refillRate: number = 1
): NextResponse | null {
  if (consumeToken(`api:${userId}`, maxTokens, refillRate)) return null;
  return NextResponse.json(
    { error: "Too many requests. Please slow down." },
    { status: 429, headers: { "Retry-After": "10" } }
  );
}
