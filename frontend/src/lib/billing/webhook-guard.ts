/**
 * Pure webhook security and edge-case helpers used by /api/billing/webhook.
 * Kept framework-free so unit tests can import directly without Next.js server runtime.
 */

export function normalizeClientIp(rawIp: string): string {
  return rawIp.trim().replace(/^::ffff:/i, "");
}

/**
 * Extract the reverse-proxy verified client IP for Paddle allowlist checking.
 * Prefers X-Real-IP (socket IP set by Nginx) over X-Forwarded-For first hop.
 */
export function extractWebhookClientIp(headers: {
  get(name: string): string | null;
}): string {
  const realIp = headers.get("x-real-ip");
  if (realIp && realIp.trim()) {
    return normalizeClientIp(realIp);
  }
  const xff = headers.get("x-forwarded-for");
  if (xff && xff.trim()) {
    return normalizeClientIp(xff.split(",")[0]);
  }
  return "";
}

/**
 * Strip /32 CIDR suffixes returned by Paddle /ips and normalize IPv4-mapped addresses.
 */
export function normalizePaddleIpList(cidrs: string[]): string[] {
  return cidrs
    .map((entry) => normalizeClientIp(entry.replace(/\/32$/i, "")))
    .filter(Boolean);
}

/**
 * Evaluate Paddle /ips allowlist. Empty list preserves signature-only fallback when
 * Paddle /ips has never succeeded since container boot.
 */
export function isAllowedPaddleIp(clientIp: string, allowedIps: string[]): boolean {
  if (!clientIp || allowedIps.length === 0) return true;
  return allowedIps.includes(normalizeClientIp(clientIp));
}

export type GuestRefundState = {
  status: string;
  userId: string | null;
  reportRequestId: string | null;
} | null;

/**
 * Decide whether a refund missing its original TOPUP transaction should return 500
 * (triggering provider retry for out-of-order webhook delivery) or 200.
 *
 * Never force retries on unfulfilled/failed guest checkouts (e.g. historic orders whose
 * completion webhook was blocked before TOPUP could be written), otherwise Paddle/Stripe
 * retries a refund webhook for days when no TOPUP will ever arrive.
 */
export function shouldRetryMissingTopupOnRefund(guestCheckout: GuestRefundState): boolean {
  if (!guestCheckout) return true;
  if (
    (guestCheckout.status === "PENDING" || guestCheckout.status === "FAILED") &&
    !guestCheckout.reportRequestId
  ) {
    return false;
  }
  return true;
}

/**
 * Distinguish cryptographic webhook signature verification failures (HTTP 403)
 * from malformed request bodies or internal errors (HTTP 400).
 */
export function isWebhookSignatureError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  const name = err.name.toLowerCase();
  const rawType = (err as Error & { type?: unknown }).type;
  const type = typeof rawType === "string" ? rawType.toLowerCase() : "";
  return (
    name.includes("signature") ||
    type.includes("signature") ||
    msg.includes("signature")
  );
}

export const PADDLE_IP_TTL_MS = 10 * 60 * 1000;
export const PADDLE_IP_FETCH_TIMEOUT_MS = 2500;

export type PaddleIpsCache = {
  ips: string[];
  fetchedAt: number;
} | null;

/**
 * Fetch Paddle's published /ips allowlist with a bounded timeout so an unresponsive
 * Paddle IP endpoint cannot consume the 5-second webhook acknowledgement window.
 * Preserves stale-while-error allowlisting and signature-only degraded fallback.
 */
export async function fetchPaddleIpsWithFallback(opts: {
  environment?: string;
  cache: PaddleIpsCache;
  now?: number;
  timeoutMs?: number;
  ttlMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<{ ips: string[]; stale: boolean; cache: PaddleIpsCache }> {
  const now = opts.now ?? Date.now();
  const ttlMs = opts.ttlMs ?? PADDLE_IP_TTL_MS;
  const timeoutMs = opts.timeoutMs ?? PADDLE_IP_FETCH_TIMEOUT_MS;
  const fetchFn = opts.fetchImpl ?? fetch;

  if (opts.cache && now - opts.cache.fetchedAt < ttlMs) {
    return { ips: opts.cache.ips, stale: false, cache: opts.cache };
  }

  try {
    const baseUrl =
      opts.environment === "production"
        ? "https://api.paddle.com"
        : "https://sandbox-api.paddle.com";
    const res = await fetchFn(`${baseUrl}/ips`, {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`Paddle /ips returned ${res.status}`);
    const data = await res.json();
    const cidrs: string[] = normalizePaddleIpList(data.data?.ipv4_cidrs || []);
    const nextCache: PaddleIpsCache = { ips: cidrs, fetchedAt: now };
    return { ips: cidrs, stale: false, cache: nextCache };
  } catch (err) {
    console.error("[webhook] Failed to fetch Paddle IPs:", err);
    // Stale-while-error: Paddle's published IPs change rarely — enforce the
    // last known-good allowlist instead of silently allowing all traffic.
    if (opts.cache && opts.cache.ips.length > 0) {
      return { ips: opts.cache.ips, stale: true, cache: opts.cache };
    }
    // Never fetched successfully — cannot enforce the allowlist for this
    // request. Cryptographic signature verification remains the primary
    // defense; log loudly so this degraded state is visible in monitoring.
    console.error(
      "[webhook] No cached Paddle IP allowlist available — IP check skipped (signature still enforced)"
    );
    return { ips: [], stale: false, cache: opts.cache };
  }
}
