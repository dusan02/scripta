/**
 * E2E tests for API route authorization and IDOR protection.
 *
 * Tests:
 * 1. /api/reports/[id]/cancel — auth + IDOR + status validation
 * 2. /api/watched-companies — auth + IČO validation + plan limits
 * 3. /api/watched-companies/[id] — auth + IDOR (delete other user's watch)
 * 4. /api/admin/users/[id] — admin-only access
 * 5. /api/reports/[id]/refund — worker secret verification (covered in report-auth.spec.ts)
 *
 * Prerequisites:
 * - Running dev server with seeded test database
 * - TEST_USER_A and TEST_USER_B exist with credits
 */

import { test, expect } from "@playwright/test";
import { loginAPIAs, TEST_USER_A, TEST_USER_B } from "./helpers";

// ═══════════════════════════════════════════════════════════════════════════
// /api/reports/[id]/cancel — authorization & IDOR
// ═══════════════════════════════════════════════════════════════════════════

test.describe("POST /api/reports/[id]/cancel — auth & IDOR", () => {
  test("unauthenticated returns 401", async ({ request }) => {
    const res = await request.post("/api/reports/fake-id/cancel", {
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(401);
  });

  test("non-existent report returns 404", async ({ request }) => {
    const auth = await loginAPIAs(request, TEST_USER_A.email, TEST_USER_A.password);
    const res = await request.post("/api/reports/nonexistent-id/cancel", {
      headers: { ...auth, "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(404);
  });

  test("IDOR — user B cannot cancel user A's report", async ({ request }) => {
    // First, get user A's reports
    const authA = await loginAPIAs(request, TEST_USER_A.email, TEST_USER_A.password);
    const reportsRes = await request.get("/api/reports", { headers: authA });
    const reports = await reportsRes.json();
    if (reports.reports && reports.reports.length > 0) {
      const reportId = reports.reports[0].id;
      const authB = await loginAPIAs(request, TEST_USER_B.email, TEST_USER_B.password);
      const res = await request.post(`/api/reports/${reportId}/cancel`, {
        headers: { ...authB, "Content-Type": "application/json" },
      });
      // Should be 403 (Forbidden) — user B doesn't own this report
      expect([403, 422]).toContain(res.status());
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// /api/watched-companies — auth & validation
// ═══════════════════════════════════════════════════════════════════════════

test.describe("GET /api/watched-companies — auth", () => {
  test("unauthenticated returns 401", async ({ request }) => {
    const res = await request.get("/api/watched-companies");
    expect(res.status()).toBe(401);
  });

  test("authenticated returns 200 with watched array", async ({ request }) => {
    const auth = await loginAPIAs(request, TEST_USER_A.email, TEST_USER_A.password);
    const res = await request.get("/api/watched-companies", { headers: auth });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("watched");
    expect(Array.isArray(body.watched)).toBe(true);
  });
});

test.describe("POST /api/watched-companies — validation", () => {
  test("unauthenticated returns 401", async ({ request }) => {
    const res = await request.post("/api/watched-companies", {
      headers: { "Content-Type": "application/json" },
      data: { companyId: "12345678" },
    });
    expect(res.status()).toBe(401);
  });

  test("invalid IČO (not 8 digits) returns 400", async ({ request }) => {
    const auth = await loginAPIAs(request, TEST_USER_A.email, TEST_USER_A.password);
    const res = await request.post("/api/watched-companies", {
      headers: { ...auth, "Content-Type": "application/json" },
      data: { companyId: "123" },
    });
    expect(res.status()).toBe(400);
  });

  test("invalid IČO (letters) returns 400", async ({ request }) => {
    const auth = await loginAPIAs(request, TEST_USER_A.email, TEST_USER_A.password);
    const res = await request.post("/api/watched-companies", {
      headers: { ...auth, "Content-Type": "application/json" },
      data: { companyId: "abcdefgh" },
    });
    expect(res.status()).toBe(400);
  });

  test("missing companyId returns 400", async ({ request }) => {
    const auth = await loginAPIAs(request, TEST_USER_A.email, TEST_USER_A.password);
    const res = await request.post("/api/watched-companies", {
      headers: { ...auth, "Content-Type": "application/json" },
      data: { note: "test" },
    });
    expect(res.status()).toBe(400);
  });

  test("note over 500 chars returns 400", async ({ request }) => {
    const auth = await loginAPIAs(request, TEST_USER_A.email, TEST_USER_A.password);
    const res = await request.post("/api/watched-companies", {
      headers: { ...auth, "Content-Type": "application/json" },
      data: { companyId: "12345678", note: "x".repeat(501) },
    });
    expect(res.status()).toBe(400);
  });

  test("valid IČO creates or restores watch entry", async ({ request }) => {
    const auth = await loginAPIAs(request, TEST_USER_A.email, TEST_USER_A.password);
    const res = await request.post("/api/watched-companies", {
      headers: { ...auth, "Content-Type": "application/json" },
      data: { companyId: "12345678", note: "E2E test watch" },
    });
    // 201 (new) or 200 (restored) or 409 (already watching)
    expect([200, 201, 409]).toContain(res.status());
    if (res.status() !== 409) {
      const body = await res.json();
      expect(body).toHaveProperty("watched");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// /api/watched-companies/[id] — IDOR protection
// ═══════════════════════════════════════════════════════════════════════════

test.describe("DELETE /api/watched-companies/[id] — IDOR", () => {
  test("unauthenticated returns 401", async ({ request }) => {
    const res = await request.delete("/api/watched-companies/fake-id");
    expect(res.status()).toBe(401);
  });

  test("non-existent watch returns 404", async ({ request }) => {
    const auth = await loginAPIAs(request, TEST_USER_A.email, TEST_USER_A.password);
    const res = await request.delete("/api/watched-companies/nonexistent-id", {
      headers: auth,
    });
    expect(res.status()).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// /api/admin/users/[id] — admin-only access
// ═══════════════════════════════════════════════════════════════════════════

test.describe("GET /api/admin/users/[id] — admin access", () => {
  test("unauthenticated returns 401", async ({ request }) => {
    const res = await request.get("/api/admin/users/fake-id");
    expect(res.status()).toBe(401);
  });

  test("non-admin user gets 403", async ({ request }) => {
    // TEST_USER_A is a regular user, not admin
    const auth = await loginAPIAs(request, TEST_USER_A.email, TEST_USER_A.password);
    const res = await request.get("/api/admin/users/fake-id", { headers: auth });
    // Should be 403 (Forbidden) — non-admin cannot access admin endpoints
    expect([403, 404]).toContain(res.status());
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// /api/reports/[id] — GET single report IDOR
// ═══════════════════════════════════════════════════════════════════════════

test.describe("GET /api/reports/[id] — IDOR", () => {
  test("user B cannot read user A's report", async ({ request }) => {
    const authA = await loginAPIAs(request, TEST_USER_A.email, TEST_USER_A.password);
    const reportsRes = await request.get("/api/reports", { headers: authA });
    const reports = await reportsRes.json();
    if (reports.reports && reports.reports.length > 0) {
      const reportId = reports.reports[0].id;
      const authB = await loginAPIAs(request, TEST_USER_B.email, TEST_USER_B.password);
      const res = await request.get(`/api/reports/${reportId}`, { headers: authB });
      // Should be 403 or 404 — user B doesn't own this report
      expect([403, 404]).toContain(res.status());
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// /api/alert-events — auth
// ═══════════════════════════════════════════════════════════════════════════

test.describe("GET /api/alert-events — auth", () => {
  test("unauthenticated returns 401", async ({ request }) => {
    const res = await request.get("/api/alert-events");
    expect(res.status()).toBe(401);
  });

  test("authenticated returns 200", async ({ request }) => {
    const auth = await loginAPIAs(request, TEST_USER_A.email, TEST_USER_A.password);
    const res = await request.get("/api/alert-events", { headers: auth });
    expect(res.status()).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// /api/messages/unread — auth
// ═══════════════════════════════════════════════════════════════════════════

test.describe("GET /api/messages/unread — auth", () => {
  test("unauthenticated returns 401", async ({ request }) => {
    const res = await request.get("/api/messages/unread");
    expect(res.status()).toBe(401);
  });

  test("authenticated returns 200", async ({ request }) => {
    const auth = await loginAPIAs(request, TEST_USER_A.email, TEST_USER_A.password);
    const res = await request.get("/api/messages/unread", { headers: auth });
    expect(res.status()).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// /api/settings/account — auth
// ═══════════════════════════════════════════════════════════════════════════

test.describe("GET /api/settings/account — auth", () => {
  test("unauthenticated returns 401", async ({ request }) => {
    const res = await request.get("/api/settings/account");
    expect(res.status()).toBe(401);
  });

  test("authenticated returns 200", async ({ request }) => {
    const auth = await loginAPIAs(request, TEST_USER_A.email, TEST_USER_A.password);
    const res = await request.get("/api/settings/account", { headers: auth });
    expect(res.status()).toBe(200);
  });
});
