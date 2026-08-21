/**
 * Convert Next.js searchParams (Record<string, string | string[] | undefined>)
 * to URLSearchParams for URL building in client components.
 *
 * This avoids useSearchParams() which forces client-side rendering.
 */
export function toURLSearchParams(
  sp: Record<string, string | string[] | undefined>,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (value === undefined) continue;
    const s = typeof value === "string" ? value : value[0];
    if (s) params.set(key, s);
  }
  return params;
}

/**
 * Get a single string value from searchParams prop.
 */
export function spStr(
  sp: Record<string, string | string[] | undefined>,
  key: string,
): string {
  const v = sp[key];
  if (!v) return "";
  return typeof v === "string" ? v : v[0] || "";
}
