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
