/**
 * HTML escaping utility for safe interpolation into email HTML content.
 *
 * Prevents XSS attacks when user-supplied text (feedback messages, support
 * tickets, admin broadcasts) is embedded into HTML email bodies. Resend
 * renders HTML emails in email clients — most strip <script>, but CSS
 * injection and link spoofing are still possible without escaping.
 *
 * @example
 *   html: `<p>${escapeHtml(userInput)}</p>`
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Sanitize a filename for safe use in HTTP Content-Disposition headers.
 *
 * Strips CR/LF characters (prevents header injection) and removes
 * characters that are invalid in filenames. Truncates to a reasonable length.
 *
 * @example
 *   const filename = sanitizeFilename(req.nextUrl.searchParams.get("filename") || "default.pdf");
 */
export function sanitizeFilename(filename: string): string {
  // Strip CR/LF and other control characters — prevents header injection
  let clean = filename.replace(/[\r\n\x00-\x1f\x7f]/g, "");
  // Remove path separators — prevents path traversal in filename
  clean = clean.replace(/[\/\\]/g, "");
  // Remove quotes (they break Content-Disposition parsing)
  clean = clean.replace(/["']/g, "");
  // Remove non-ASCII characters — Content-Disposition header requires
  // ByteString (latin1), so characters >255 cause TypeError in Next.js.
  // Use RFC 5987 filename* encoding for non-ASCII names if needed.
  clean = clean.replace(/[^\x20-\x7e]/g, "");
  // Collapse multiple spaces/hyphens
  clean = clean.replace(/\s+/g, " ").trim();
  // Truncate to 200 chars
  if (clean.length > 200) clean = clean.slice(0, 200);
  // Fallback if empty after sanitization
  return clean || "download";
}
