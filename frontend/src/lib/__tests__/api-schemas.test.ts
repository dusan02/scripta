/**
 * Unit tests for src/lib/api-schemas.ts — Zod validation schemas.
 *
 * Tests cover valid inputs, invalid inputs, edge cases, and refinements.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  icoSchema,
  emailSchema,
  forgotPasswordSchema,
  verifyEmailSchema,
  feedbackSchema,
  messageCreateSchema,
  messageMarkReadSchema,
  settingsPatchSchema,
  accountDeleteSchema,
  watchedCompanyCreateSchema,
  checkoutSchema,
  confirmSchema,
  revalidateSchema,
  alertListQuerySchema,
} from "@/lib/api-schemas";

describe("api-schemas — icoSchema", () => {
  it("accepts 8-digit IČO", () => {
    assert.equal(icoSchema.safeParse("12345678").success, true);
  });

  it("rejects 7-digit IČO", () => {
    assert.equal(icoSchema.safeParse("1234567").success, false);
  });

  it("rejects 9-digit IČO", () => {
    assert.equal(icoSchema.safeParse("123456789").success, false);
  });

  it("rejects non-numeric", () => {
    assert.equal(icoSchema.safeParse("1234567a").success, false);
  });

  it("rejects empty string", () => {
    assert.equal(icoSchema.safeParse("").success, false);
  });
});

describe("api-schemas — emailSchema", () => {
  it("accepts valid email", () => {
    assert.equal(emailSchema.safeParse("test@example.com").success, true);
  });

  it("rejects missing @", () => {
    assert.equal(emailSchema.safeParse("notanemail").success, false);
  });

  it("rejects missing domain", () => {
    assert.equal(emailSchema.safeParse("test@").success, false);
  });

  it("rejects empty", () => {
    assert.equal(emailSchema.safeParse("").success, false);
  });
});

describe("api-schemas — forgotPasswordSchema", () => {
  it("accepts valid email", () => {
    assert.equal(forgotPasswordSchema.safeParse({ email: "user@test.sk" }).success, true);
  });

  it("rejects invalid email", () => {
    assert.equal(forgotPasswordSchema.safeParse({ email: "bad" }).success, false);
  });
});

describe("api-schemas — verifyEmailSchema", () => {
  it("accepts token ≥16 chars", () => {
    assert.equal(verifyEmailSchema.safeParse({ token: "abcdef1234567890" }).success, true);
  });

  it("rejects short token", () => {
    assert.equal(verifyEmailSchema.safeParse({ token: "short" }).success, false);
  });
});

describe("api-schemas — feedbackSchema", () => {
  it("accepts valid feedback", () => {
    assert.equal(feedbackSchema.safeParse({ category: "BUG", message: "Something broke" }).success, true);
  });

  it("accepts all valid categories", () => {
    for (const cat of ["BUG", "IMPROVEMENT", "QUESTION", "OTHER"]) {
      assert.equal(feedbackSchema.safeParse({ category: cat, message: "msg" }).success, true);
    }
  });

  it("rejects invalid category", () => {
    assert.equal(feedbackSchema.safeParse({ category: "INVALID", message: "msg" }).success, false);
  });

  it("rejects empty message", () => {
    assert.equal(feedbackSchema.safeParse({ category: "BUG", message: "" }).success, false);
  });

  it("rejects message >5000 chars", () => {
    assert.equal(feedbackSchema.safeParse({ category: "BUG", message: "x".repeat(5001) }).success, false);
  });

  it("accepts optional requestId", () => {
    assert.equal(feedbackSchema.safeParse({ category: "BUG", message: "msg", requestId: "req123" }).success, true);
  });
});

describe("api-schemas — messageCreateSchema", () => {
  it("accepts valid message", () => {
    assert.equal(messageCreateSchema.safeParse({ title: "Hello", message: "World" }).success, true);
  });

  it("rejects missing title", () => {
    assert.equal(messageCreateSchema.safeParse({ message: "World" }).success, false);
  });

  it("rejects missing message", () => {
    assert.equal(messageCreateSchema.safeParse({ title: "Hello" }).success, false);
  });

  it("rejects title >200 chars", () => {
    assert.equal(messageCreateSchema.safeParse({ title: "x".repeat(201), message: "msg" }).success, false);
  });
});

describe("api-schemas — messageMarkReadSchema", () => {
  it("accepts array of IDs", () => {
    assert.equal(messageMarkReadSchema.safeParse({ messageIds: ["id1", "id2"] }).success, true);
  });

  it("rejects empty array", () => {
    assert.equal(messageMarkReadSchema.safeParse({ messageIds: [] }).success, false);
  });

  it("rejects >100 IDs", () => {
    assert.equal(messageMarkReadSchema.safeParse({ messageIds: Array(101).fill("id") }).success, false);
  });
});

describe("api-schemas — settingsPatchSchema", () => {
  it("accepts partial settings", () => {
    assert.equal(settingsPatchSchema.safeParse({ reportLanguage: "sk" }).success, true);
  });

  it("rejects empty object (refine)", () => {
    assert.equal(settingsPatchSchema.safeParse({}).success, false);
  });

  it("accepts null for date fields", () => {
    assert.equal(settingsPatchSchema.safeParse({ crzDateFrom: null }).success, true);
  });

  it("accepts valid date string", () => {
    assert.equal(settingsPatchSchema.safeParse({ crzDateFrom: "2024-01-01" }).success, true);
  });

  it("rejects invalid date string", () => {
    assert.equal(settingsPatchSchema.safeParse({ crzDateFrom: "not-a-date" }).success, false);
  });
});

describe("api-schemas — accountDeleteSchema", () => {
  it("accepts non-empty password", () => {
    assert.equal(accountDeleteSchema.safeParse({ password: "secret" }).success, true);
  });

  it("rejects empty password", () => {
    assert.equal(accountDeleteSchema.safeParse({ password: "" }).success, false);
  });
});

describe("api-schemas — watchedCompanyCreateSchema", () => {
  it("accepts valid IČO with optional note", () => {
    assert.equal(watchedCompanyCreateSchema.safeParse({ companyId: "12345678", note: "Watch" }).success, true);
  });

  it("accepts valid IČO without note", () => {
    assert.equal(watchedCompanyCreateSchema.safeParse({ companyId: "12345678" }).success, true);
  });

  it("rejects invalid IČO", () => {
    assert.equal(watchedCompanyCreateSchema.safeParse({ companyId: "123" }).success, false);
  });

  it("rejects note >500 chars", () => {
    assert.equal(watchedCompanyCreateSchema.safeParse({ companyId: "12345678", note: "x".repeat(501) }).success, false);
  });
});

describe("api-schemas — checkoutSchema", () => {
  it("accepts non-empty planId", () => {
    assert.equal(checkoutSchema.safeParse({ planId: "payg1" }).success, true);
  });

  it("rejects empty planId", () => {
    assert.equal(checkoutSchema.safeParse({ planId: "" }).success, false);
  });
});

describe("api-schemas — confirmSchema", () => {
  it("accepts valid transactionId", () => {
    assert.equal(confirmSchema.safeParse({ transactionId: "txn_123" }).success, true);
  });

  it("rejects empty transactionId", () => {
    assert.equal(confirmSchema.safeParse({ transactionId: "" }).success, false);
  });

  it("rejects transactionId >200 chars", () => {
    assert.equal(confirmSchema.safeParse({ transactionId: "x".repeat(201) }).success, false);
  });
});

describe("api-schemas — revalidateSchema", () => {
  it("defaults type to 'all'", () => {
    const result = revalidateSchema.safeParse({});
    assert.equal(result.success, true);
    if (result.success) assert.equal(result.data.type, "all");
  });

  it("accepts type='path' with path", () => {
    assert.equal(revalidateSchema.safeParse({ type: "path", path: "/firma/123" }).success, true);
  });

  it("rejects type='path' without path (refine)", () => {
    assert.equal(revalidateSchema.safeParse({ type: "path" }).success, false);
  });

  it("rejects type='path' with empty path (refine)", () => {
    assert.equal(revalidateSchema.safeParse({ type: "path", path: "" }).success, false);
  });
});

describe("api-schemas — alertListQuerySchema", () => {
  it("defaults to limit=50, offset=0", () => {
    const result = alertListQuerySchema.safeParse({});
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.limit, 50);
      assert.equal(result.data.offset, 0);
    }
  });

  it("coerces string numbers", () => {
    const result = alertListQuerySchema.safeParse({ limit: "10", offset: "5" });
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.limit, 10);
      assert.equal(result.data.offset, 5);
    }
  });

  it("rejects limit >100", () => {
    assert.equal(alertListQuerySchema.safeParse({ limit: 101 }).success, false);
  });

  it("rejects limit <1", () => {
    assert.equal(alertListQuerySchema.safeParse({ limit: 0 }).success, false);
  });

  it("rejects negative offset", () => {
    assert.equal(alertListQuerySchema.safeParse({ offset: -1 }).success, false);
  });
});
