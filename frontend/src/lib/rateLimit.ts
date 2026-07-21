import { NextRequest, NextResponse } from "next/server";

interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
}

// ── In-memory fallback (dev only) ──────────────────────────────────────────────

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const memStore = new Map<string, RateLimitEntry>();
const CLEANUP_INTERVAL = 5 * 60 * 1000;
let lastCleanup = Date.now();

function memCleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  memStore.forEach((entry, key) => {
    if (now > entry.resetTime) memStore.delete(key);
  });
}

function memRateLimit(key: string, options: RateLimitOptions): RateLimitResult {
  memCleanup();
  const now = Date.now();
  const entry = memStore.get(key);

  if (!entry || now > entry.resetTime) {
    memStore.set(key, { count: 1, resetTime: now + options.windowMs });
    return { allowed: true, remaining: options.maxRequests - 1, resetTime: now + options.windowMs };
  }

  entry.count++;
  if (entry.count > options.maxRequests) {
    return { allowed: false, remaining: 0, resetTime: entry.resetTime };
  }

  return { allowed: true, remaining: options.maxRequests - entry.count, resetTime: entry.resetTime };
}

// ── Upstash Redis REST (production) ────────────────────────────────────────────

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redisRateLimit(key: string, options: RateLimitOptions): Promise<RateLimitResult> {
  const now = Date.now();
  const resetTime = now + options.windowMs;
  const redisKey = `ratelimit:${key}`;

  const url = `${UPSTASH_URL}/incr/${encodeURIComponent(redisKey)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });

  if (!res.ok) {
    return { allowed: true, remaining: options.maxRequests - 1, resetTime };
  }

  const data = await res.json();
  const count = parseInt(data.result ?? "0", 10);

  if (count === 1) {
    const expireUrl = `${UPSTASH_URL}/expire/${encodeURIComponent(redisKey)}/${Math.ceil(options.windowMs / 1000)}`;
    await fetch(expireUrl, {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    });
  }

  if (count > options.maxRequests) {
    return { allowed: false, remaining: 0, resetTime };
  }

  return { allowed: true, remaining: options.maxRequests - count, resetTime };
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function rateLimit(
  req: NextRequest,
  options: RateLimitOptions
): Promise<RateLimitResult> {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
             req.headers.get("x-real-ip") ||
             "unknown";

  const key = `${ip}:${options.windowMs}:${options.maxRequests}`;

  if (UPSTASH_URL && UPSTASH_TOKEN) {
    try {
      return await redisRateLimit(key, options);
    } catch {
      if (process.env.NODE_ENV === "production") {
        console.error("[rateLimit] Upstash Redis failed in production — denying request");
        return { allowed: false, remaining: 0, resetTime: Date.now() + options.windowMs };
      }
      return memRateLimit(key, options);
    }
  }

  if (process.env.NODE_ENV === "production") {
    console.error("[rateLimit] UPSTASH_REDIS_REST_URL/TOKEN not configured in production — denying request");
    return { allowed: false, remaining: 0, resetTime: Date.now() + options.windowMs };
  }

  return memRateLimit(key, options);
}

export function rateLimitResponse(result: RateLimitResult) {
  return NextResponse.json(
    { error: "Príliš veľa požiadaviek. Skúste to znova o chvíľu." },
    {
      status: 429,
      headers: {
        "Retry-After": String(Math.ceil((result.resetTime - Date.now()) / 1000)),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(result.resetTime),
      },
    }
  );
}
