/**
 * Bounded, single-flight DB healthcheck helper.
 *
 * Prevents concurrent /api/health probes from piling onto an exhausted Prisma
 * pool, clears timeout timers cleanly, and suppresses late rejections after
 * timeout so Node.js never sees unhandledPromiseRejection.
 */

export interface DbHealthResult {
  ok: boolean;
  latencyMs: number;
  cached: boolean;
}

export interface DbHealthOptions {
  timeoutMs?: number;
  okCacheTtlMs?: number;
  errorCacheTtlMs?: number;
  now?: () => number;
}

export function createDbHealthChecker(
  probe: () => Promise<unknown>,
  options: DbHealthOptions = {}
): () => Promise<DbHealthResult> {
  const timeoutMs = options.timeoutMs ?? 2500;
  const okCacheTtlMs = options.okCacheTtlMs ?? 2000;
  const errorCacheTtlMs = options.errorCacheTtlMs ?? 1000;
  const now = options.now ?? Date.now;

  let inFlight: Promise<Omit<DbHealthResult, "cached">> | null = null;
  let lastResult: { ok: boolean; latencyMs: number; expiresAt: number } | null = null;

  return async function checkDbHealth(): Promise<DbHealthResult> {
    const ts = now();
    if (lastResult && ts < lastResult.expiresAt) {
      return {
        ok: lastResult.ok,
        latencyMs: lastResult.latencyMs,
        cached: true,
      };
    }

    if (!inFlight) {
      const startedAt = now();
      inFlight = (async () => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const probePromise = Promise.resolve().then(() => probe());
        // Swallow late rejection if timeout wins the race first
        probePromise.catch(() => {});

        const timeoutPromise = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error("DB healthcheck timeout"));
          }, timeoutMs);
          if (typeof timer === "object" && timer !== null && "unref" in timer) {
            timer.unref();
          }
        });

        try {
          await Promise.race([probePromise, timeoutPromise]);
          const latencyMs = Math.max(0, now() - startedAt);
          const ttl = okCacheTtlMs;
          lastResult = { ok: true, latencyMs, expiresAt: now() + ttl };
          return { ok: true, latencyMs };
        } catch {
          const latencyMs = Math.max(0, now() - startedAt);
          const ttl = errorCacheTtlMs;
          lastResult = { ok: false, latencyMs, expiresAt: now() + ttl };
          return { ok: false, latencyMs };
        } finally {
          if (timer !== undefined) {
            clearTimeout(timer);
          }
          inFlight = null;
        }
      })();
    }

    const result = await inFlight;
    return { ...result, cached: false };
  };
}
