import type { ActorContext } from "@/lib/server/workspace";

/**
 * Best-effort burst protection for the expensive routes.
 *
 * This is an in-process fixed window: on Vercel it protects each instance
 * rather than the whole fleet, and it is deliberately not a replacement for
 * the DB-backed guest counters. It exists to stop one client from firing a
 * burst of uploads/chats (each of which costs an LLM call) at a single
 * instance.
 */
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 10_000;

const LIMITS = {
  chat: { limit: 30, windowMs: 60_000 },
  upload: { limit: 6, windowMs: 60_000 },
  retry: { limit: 3, windowMs: 60_000 },
} as const;

export type RateLimitScope = keyof typeof LIMITS;

/** Returns null when allowed, or the number of seconds to wait. */
export function rateLimit(
  actor: ActorContext,
  scope: RateLimitScope
): number | null {
  const { limit, windowMs } = LIMITS[scope];
  const key = `${scope}:${actor.type}:${actor.ownerId}`;
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size >= MAX_KEYS) {
      prune(now);
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }

  if (bucket.count >= limit) {
    return Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  }

  bucket.count += 1;
  return null;
}

function prune(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}
