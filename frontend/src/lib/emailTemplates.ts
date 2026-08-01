// @ts-ignore — .ts extension required for Node.js native test runner compatibility
import { escapeHtml } from "./sanitize.ts";

/**
 * Standard email button style — green CTA button.
 * Exported for backwards compatibility (used by emailButton).
 */
export function emailButtonStyle(): string {
  return "display: inline-block; background-color: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; margin-top: 8px;";
}

/**
 * Standard email wrapper — provides consistent font, max-width, and footer
 * across all transactional emails. All user-supplied content passed to
 * `bodyHtml` must already be escaped via `escapeHtml()`.
 *
 * @example
 *   html: emailShell(`<h2>Report Ready</h2><p>${escapeHtml(companyName)}</p>`)
 */
export function emailShell(bodyHtml: string): string {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #09090b;">
      ${bodyHtml}
      <hr style="border: none; border-top: 1px solid #e4e4e7; margin: 24px 0;">
      <p style="color: #a1a1aa; font-size: 12px;">Verifa.sk — Business Risk Report zo štátnych registrov SR.</p>
    </div>
  `;
}

/**
 * Standard CTA button for email templates.
 * `href` must be a URL (not user input) — URLs don't need HTML escaping
 * in href attributes, but & should be encoded as &amp; in HTML.
 * `label` is escaped via escapeHtml() to prevent XSS.
 */
export function emailButton(href: string, label: string): string {
  return `<a href="${href}" style="${emailButtonStyle()}">${escapeHtml(label)}</a>`;
}
