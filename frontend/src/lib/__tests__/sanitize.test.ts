import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, sanitizeFilename } from "../sanitize";

describe("escapeHtml", () => {
  it("escapes < > & \" ' characters", () => {
    assert.equal(
      escapeHtml(`<script>alert("xss")</script>`),
      "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;"
    );
  });

  it("escapes single quotes", () => {
    assert.equal(escapeHtml(`it's`), "it&#39;s");
  });

  it("escapes ampersands first (no double-escaping)", () => {
    assert.equal(escapeHtml("a & b"), "a &amp; b");
  });

  it("handles empty string", () => {
    assert.equal(escapeHtml(""), "");
  });

  it("handles plain text without special chars (no change)", () => {
    assert.equal(escapeHtml("Hello World 123"), "Hello World 123");
  });

  it("escapes HTML attributes injection", () => {
    assert.equal(
      escapeHtml(`" onmouseover="alert(1)`),
      "&quot; onmouseover=&quot;alert(1)"
    );
  });

  it("escapes CSS injection in style attributes", () => {
    assert.equal(
      escapeHtml(`</p><style>body{display:none}</style><p>`),
      "&lt;/p&gt;&lt;style&gt;body{display:none}&lt;/style&gt;&lt;p&gt;"
    );
  });
});

describe("sanitizeFilename", () => {
  it("strips CR/LF characters (header injection prevention)", () => {
    const malicious = "file\r\nSet-Cookie: evil=true";
    const result = sanitizeFilename(malicious);
    assert.ok(!result.includes("\r"), "should not contain CR");
    assert.ok(!result.includes("\n"), "should not contain LF");
    // "Set-Cookie" text may remain as part of filename, but without CR/LF
    // it cannot inject a new header — it's just a harmless string in the filename
  });

  it("strips path separators", () => {
    assert.equal(sanitizeFilename("../../etc/passwd"), "....etcpasswd");
    assert.equal(sanitizeFilename("foo\\bar"), "foobar");
  });

  it("strips quotes", () => {
    assert.equal(sanitizeFilename('file"name'), "filename");
    assert.equal(sanitizeFilename("file'name"), "filename");
  });

  it("strips control characters", () => {
    assert.equal(sanitizeFilename("file\x00\x01\x02name"), "filename");
    assert.equal(sanitizeFilename("file\x7fname"), "filename");
  });

  it("truncates to 200 characters", () => {
    const long = "a".repeat(300);
    const result = sanitizeFilename(long);
    assert.equal(result.length, 200);
  });

  it("returns fallback for empty string", () => {
    assert.equal(sanitizeFilename(""), "download");
  });

  it("returns fallback for string with only special chars", () => {
    assert.equal(sanitizeFilename('""\'\\\\///'), "download");
  });

  it("preserves normal filenames", () => {
    assert.equal(sanitizeFilename("report.pdf"), "report.pdf");
    assert.equal(sanitizeFilename("evidence-binder-abc123.pdf"), "evidence-binder-abc123.pdf");
  });

  it("preserves spaces and hyphens", () => {
    assert.equal(sanitizeFilename("my report - final.pdf"), "my report - final.pdf");
  });
});
