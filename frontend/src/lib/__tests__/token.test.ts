/**
 * Unit tests for src/lib/token.ts — hashToken()
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { hashToken } from "@/lib/token";

describe("token.ts — hashToken()", () => {
  it("returns a 64-char hex string (SHA-256)", () => {
    const hash = hashToken("my-secret-token");
    assert.equal(hash.length, 64);
    assert.match(hash, /^[0-9a-f]{64}$/);
  });

  it("matches Node crypto SHA-256 output", () => {
    const token = "abc123xyz";
    const expected = crypto.createHash("sha256").update(token).digest("hex");
    assert.equal(hashToken(token), expected);
  });

  it("is deterministic — same input → same output", () => {
    assert.equal(hashToken("test"), hashToken("test"));
  });

  it("different inputs → different outputs", () => {
    assert.notEqual(hashToken("token-a"), hashToken("token-b"));
  });

  it("handles empty string", () => {
    const hash = hashToken("");
    assert.equal(hash, crypto.createHash("sha256").update("").digest("hex"));
    assert.equal(hash.length, 64);
  });

  it("handles unicode/special characters", () => {
    const hash = hashToken("hěšký-ťöken-🔐");
    assert.equal(hash.length, 64);
    assert.match(hash, /^[0-9a-f]{64}$/);
  });

  it("produces a one-way hash (cannot reverse to token)", () => {
    const hash = hashToken("irreversible-test");
    // The hash should NOT contain the original token
    assert.ok(!hash.includes("irreversible"));
  });
});
