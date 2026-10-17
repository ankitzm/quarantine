/**
 * In-memory token bucket per key. ponytail: per-process, so limits reset on restart and are not shared
 * across replicas; move to Redis if the web tier scales out.
 */
export function tokenBucket({ capacity, perMs }: { capacity: number; perMs: number }) {
  const buckets = new Map<string, { tokens: number; at: number }>();
  return (key: string, now = Date.now()): boolean => {
    const b = buckets.get(key) ?? { tokens: capacity, at: now };
    b.tokens = Math.min(capacity, b.tokens + ((now - b.at) * capacity) / perMs);
    b.at = now;
    const allowed = b.tokens >= 1;
    if (allowed) b.tokens -= 1;
    buckets.set(key, b);
    if (buckets.size > 10_000) buckets.clear();
    return allowed;
  };
}

export function clientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'local';
}
