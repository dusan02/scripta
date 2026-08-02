import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { emailShell, emailButton, emailButtonStyle } from "../emailTemplates";

describe("emailShell", () => {
  it("wraps body in standard email container with footer (default sk)", () => {
    const result = emailShell("<h2>Test</h2><p>Hello</p>");
    assert.ok(result.includes("font-family: sans-serif"));
    assert.ok(result.includes("max-width: 600px"));
    assert.ok(result.includes("<h2>Test</h2><p>Hello</p>"));
    assert.ok(result.includes("Verifa.sk — Business Risk Report zo štátnych registrov SR."));
  });

  it("uses English footer when lang=en", () => {
    const result = emailShell("<p>body</p>", "en");
    assert.ok(result.includes("Verifa.sk — Business Risk Report from Slovak state registries."));
  });

  it("uses German footer when lang=de", () => {
    const result = emailShell("<p>body</p>", "de");
    assert.ok(result.includes("Verifa.sk — Business Risk Report aus staatlichen Registern der Slowakei."));
  });

  it("includes hr separator before footer", () => {
    const result = emailShell("<p>body</p>");
    assert.ok(result.includes("<hr"));
    assert.ok(result.includes("border-top: 1px solid"));
  });
});

describe("emailButton", () => {
  it("generates anchor tag with button styles", () => {
    const result = emailButton("https://verifa.sk/credits", "Zakúpiť");
    assert.ok(result.startsWith('<a href="https://verifa.sk/credits"'));
    assert.ok(result.includes(">Zakúpiť</a>"));
    assert.ok(result.includes("background-color: #10b981"));
  });

  it("escapes label text (XSS prevention)", () => {
    const result = emailButton("https://verifa.sk", '<script>alert(1)</script>');
    assert.ok(!result.includes("<script>"));
    assert.ok(result.includes("&lt;script&gt;"));
  });

  it("preserves URL in href (URLs don't need HTML escaping except &)", () => {
    const result = emailButton("https://verifa.sk/credits?success=1", "Klikni");
    assert.ok(result.includes('href="https://verifa.sk/credits?success=1"'));
  });
});

describe("emailButtonStyle", () => {
  it("returns inline CSS string for buttons", () => {
    const style = emailButtonStyle();
    assert.ok(style.includes("background-color: #10b981"));
    assert.ok(style.includes("color: white"));
    assert.ok(style.includes("border-radius: 6px"));
  });
});
