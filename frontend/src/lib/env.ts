/**
 * Centralized environment variable access with production fail-fast.
 *
 * In production, missing required env vars throw immediately instead of
 * silently falling back to localhost/empty defaults — preventing the app
 * from starting in a vulnerable or broken state.
 */

const _isProduction = process.env.NODE_ENV === "production";

/**
 * Returns NEXTAUTH_URL, throwing in production if not set.
 * In development, falls back to http://localhost:3000.
 */
export const NEXTAUTH_URL = (() => {
  const url = process.env.NEXTAUTH_URL;
  if (!url) {
    if (_isProduction) {
      throw new Error("[ENV] NEXTAUTH_URL must be set in production — refusing to start with localhost fallback.");
    }
    return "http://localhost:3000";
  }
  return url;
})();
