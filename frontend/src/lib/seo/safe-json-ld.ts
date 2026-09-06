/**
 * Safe JSON-LD serialization for embedding structured data in
 * `<script type="application/ld+json">` elements.
 *
 * WHY: `JSON.stringify()` does NOT escape `</script>`. If any serialized
 * value contains that substring (e.g. a company name scraped from an
 * external register: `Foo </script><script>alert(1)</script> s.r.o.`),
 * the browser closes the JSON-LD script element early and the remainder
 * is parsed as HTML — a stored XSS vector on public, cacheable pages.
 *
 * The fix: escape `<` (and the HTML comment opener sequence) so the
 * serialized JSON can never terminate its host <script> element.
 * `\u003c` inside a JSON string literal is decoded by the JSON parser
 * back to `<` — search engines still see the original value.
 */

/** Characters that must be escaped when embedding JSON in a <script> element. */
const SCRIPT_BREAKOUT_RE = /</g;

/**
 * Serialize a JSON-LD object so it is safe to embed via
 * `dangerouslySetInnerHTML={{ __html: safeJsonLd(data) }}`.
 *
 * - `<` is escaped to `\u003c` (prevents `</script>` breakout)
 * - U+2028 / U+2029 line separators are escaped (valid JSON, invalid JS —
 *   keeps the payload safe even if it ever lands in a classic script)
 * - `<!--` is covered by the `<` escape (it cannot appear once every
 *   `<` is escaped)
 */
export function safeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(SCRIPT_BREAKOUT_RE, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
