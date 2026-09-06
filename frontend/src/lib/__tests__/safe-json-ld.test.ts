/**
 * Security tests for safeJsonLd — JSON-LD <script> breakout prevention.
 *
 * A company name (or any externally-sourced string) containing `</script>`
 * must never terminate the host <script type="application/ld+json"> element
 * when embedded via dangerouslySetInnerHTML.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { safeJsonLd } from "../seo/safe-json-ld";

/** The exact breakout sequence from the original XSS vector. */
const SCRIPT_BREAKOUT = "</script><script>alert(1)</script>";

describe("safeJsonLd — script breakout prevention", () => {
  it("escapes </script> so it cannot terminate the host script element", () => {
    const output = safeJsonLd({ name: `Foo ${SCRIPT_BREAKOUT} s.r.o.` });

    // The literal `</script>` sequence must NOT appear in the output —
    // if it did, the browser would close the JSON-LD script early and
    // treat the rest as executable HTML.
    assert.ok(
      !output.includes("</script>"),
      `output must not contain a raw "</script>" sequence, got: ${output}`
    );
    // Every `<` is escaped — nothing can form a tag at all
    assert.ok(!output.includes("<"), "output must not contain any raw '<'");
  });

  it("escapes a bare <script> opener", () => {
    const output = safeJsonLd({ name: "<script>alert(1)</script>" });
    assert.ok(!output.includes("<"), "no raw '<' allowed");
    assert.ok(!output.includes("</script>"));
  });

  it("neutralizes HTML comment openers (<!--) — no nested-comment tricks", () => {
    const output = safeJsonLd({ name: "<!--<script>alert(1)</script>-->" });
    assert.ok(!output.includes("<"), "no raw '<' allowed");
    assert.ok(!output.includes("<!--"));
  });

  it("escapes U+2028 and U+2029 line separators", () => {
    const output = safeJsonLd({ name: "a b c" });
    assert.ok(!output.includes(" "), "U+2028 must be escaped");
    assert.ok(!output.includes(" "), "U+2029 must be escaped");
  });

  it("round-trips: JSON.parse recovers the original value (SEO intact)", () => {
    const malicious = `Foo ${SCRIPT_BREAKOUT} & "quotes" 'single' \\ s.r.o.`;
    const output = safeJsonLd({ "@type": "Organization", name: malicious });

    // The escaped payload must still be valid JSON that decodes to the
    // original string — search engines see the real company name.
    const parsed = JSON.parse(output);
    assert.equal(parsed.name, malicious);
    assert.equal(parsed["@type"], "Organization");
  });

  it("keeps ampersands, quotes and unicode intact (no over-escaping)", () => {
    const name = `Mondi SCP, a.s. — "obchod" & 'spol' © ™`;
    const output = safeJsonLd({ name });
    const parsed = JSON.parse(output);
    assert.equal(parsed.name, name);
    // & must stay raw (&amp; would corrupt the value for JSON consumers)
    assert.ok(output.includes("&"));
  });

  it("handles a normal company name unchanged (safe path)", () => {
    const output = safeJsonLd({ name: "U. S. Steel Košice, s.r.o.", ico: "36199222" });
    const parsed = JSON.parse(output);
    assert.equal(parsed.name, "U. S. Steel Košice, s.r.o.");
    assert.equal(parsed.ico, "36199222");
  });

  it("escapes < in nested structures (arrays, objects)", () => {
    const output = safeJsonLd({
      itemListElement: [
        { name: `A ${SCRIPT_BREAKOUT}` },
        { name: "B" },
      ],
    });
    assert.ok(!output.includes("<"), "no raw '<' anywhere in the payload");
    const parsed = JSON.parse(output);
    assert.equal(parsed.itemListElement[0].name, `A ${SCRIPT_BREAKOUT}`);
  });

  it("simulates the real embedding: full script element stays inert", () => {
    // Reproduce exactly what the page renders:
    // <script type="application/ld+json">{__html}</script>
    const evil = { name: `x${SCRIPT_BREAKOUT}y` };
    const embedded = `<script type="application/ld+json">${safeJsonLd(evil)}</script>`;

    // Count script openers/closers: exactly ONE closing sequence overall
    // (the host's own), meaning the payload never closed it early.
    const closers = embedded.match(/<\/script>/g) || [];
    assert.equal(closers.length, 1, "payload must not add extra </script> closers");

    // And no second executable <script> can be formed from the payload
    const openers = embedded.match(/<script/g) || [];
    assert.equal(openers.length, 1, "payload must not add extra <script> openers");
  });
});
