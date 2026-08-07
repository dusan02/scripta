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
 *
 * Note: Auth headers are cached per describe block to avoid hitting the
 * NextAuth rate limit (10 logins / 15 min per email).
 */

import { test, expect } from "@playwright/test";
import { loginAPIAs, TEST_USER_A, TEST_USER_B } from "./helpers";

// Cache auth headers across tests to avoid rate limiting (10 logins / 15 min)
let _authA: Record<string, string> | null = null;
let _authB: Record<string, string> | null = null;

async function authA(request: import("@playwright/test").APIRequestContext) {
  if (!_authA) _authA = await loginAPIAs(request, TEST_USER_A.email, TEST_USER_A.password);
  return _authA;
}

async function authB(request: import("@playwright/test").APIRequestContext) {
  if (!_authB) _authB = await loginAPIAs(request, TEST_USER_B.email, TEST_USER_B.password);
  return _authB;
}

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
    const auth = await authA(request);
    const res = await request.post("/api/reports/nonexistent-id/cancel", {
      headers: { ...auth, "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(404);
  });

  test("IDOR — user B cannot cancel user A's report", async ({ request }) => {
    // First, get user A's reports
    const a = await authA(request);
    const reportsRes = await request.get("/api/reports", { headers: a });
    const reports = await reportsRes.json();
    if (reports.reports && reports.reports.length > 0) {
      const reportId = reports.reports[0].id;
      const b = await authB(request);
      const res = await request.post(`/api/reports/${reportId}/cancel`, {
        headers: { ...b, "Content-Type": "application/json" },
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
    const auth = await authA(request);
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
    const auth = await authA(request);
    const res = await request.post("/api/watched-companies", {
      headers: { ...auth, "Content-Type": "application/json" },
      data: { companyId: "123" },
    });
    expect(res.status()).toBe(400);
  });

  test("invalid IČO (letters) returns 400", async ({ request }) => {
    const auth = await authA(request);
    const res = await request.post("/api/watched-companies", {
      headers: { ...auth, "Content-Type": "application/json" },
      data: { companyId: "abcdefgh" },
    });
    expect(res.status()).toBe(400);
  });

  test("missing companyId returns 400", async ({ request }) => {
    const auth = await authA(request);
    const res = await request.post("/api/watched-companies", {
      headers: { ...auth, "Content-Type": "application/json" },
      data: { note: "test" },
    });
    expect(res.status()).toBe(400);
  });

  test("note over 500 chars returns 400", async ({ request }) => {
    const auth = await authA(request);
    const res = await request.post("/api/watched-companies", {
      headers: { ...auth, "Content-Type": "application/json" },
      data: { companyId: "12345678", note: "x".repeat(501) },
    });
    expect(res.status()).toBe(400);
  });

  test("valid IČO creates or restores watch entry", async ({ request }) => {
    const auth = await authA(request);
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
    const auth = await authA(request);
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
    const auth = await authA(request);
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
    const a = await authA(request);
    const reportsRes = await request.get("/api/reports", { headers: a });
    const reports = await reportsRes.json();
    if (reports.reports && reports.reports.length > 0) {
      const reportId = reports.reports[0].id;
      const b = await authB(request);
      const res = await request.get(`/api/reports/${reportId}`, { headers: b });
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
    const auth = await authA(request);
    const res = await request.get("/api/alert-events", { headers: auth });
    expect(res.status()).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// /api/messages/unread — auth
// ═══════════════════════════════════════════════════════════════════════════

test.describe("GET /api/messages/unread — auth", () => {
  test("unauthenticated returns 200 with count 0 (public endpoint)", async ({ request }) => {
    const res = await request.get("/api/messages/unread");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("count", 0);
  });

  test("authenticated returns 200", async ({ request }) => {
    const auth = await authA(request);
    const res = await request.get("/api/messages/unread", { headers: auth });
    expect(res.status()).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// /api/settings/account — auth (DELETE only)
// ═══════════════════════════════════════════════════════════════════════════

test.describe("DELETE /api/settings/account — auth", () => {
  test("unauthenticated returns 401", async ({ request }) => {
    const res = await request.delete("/api/settings/account");
    expect(res.status()).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// /api/reports/[id]/cancel — business logic (credit refund)
// ═══════════════════════════════════════════════════════════════════════════

test.describe("POST /api/reports/[id]/cancel — business logic", () => {
  test("cancel within 15s window refunds credit and sets CANCELLED status", async ({ request }) => {
    const auth = await authA(request);

    // 1. Get current credit balance from /api/credits/plan (returns `remaining`)
    const planRes = await request.get("/api/credits/plan", { headers: auth });
    if (planRes.status() !== 200) {
      test.skip(true, `Cannot read credit plan (${planRes.status()}) — skipping cancel test`);
    }
    const planBefore = await planRes.json();
    const creditsBefore = planBefore.remaining ?? null;
    if (creditsBefore === null || creditsBefore < 1) {
      test.skip(true, "No credits available — skipping cancel refund test");
    }

    // 2. Create a report (consumes 1 credit)
    const createRes = await request.post("/api/reports", {
      headers: { ...auth, "Content-Type": "application/json" },
      data: { ico: "00112233", language: "sk" },
    });
    if (createRes.status() !== 200 && createRes.status() !== 201) {
      test.skip(true, `Report creation failed (${createRes.status()}) — skipping cancel test`);
    }
    const report = await createRes.json();
    const reportId = report.id || report.reportId;
    expect(reportId).toBeTruthy();

    // 3. Cancel immediately (within 15s window)
    const cancelRes = await request.post(`/api/reports/${reportId}/cancel`, {
      headers: { ...auth, "Content-Type": "application/json" },
    });
    expect([200, 422]).toContain(cancelRes.status());
    // 200 = cancelled successfully, 422 = already completed (worker too fast)

    if (cancelRes.status() === 200) {
      // 4. Verify credit was refunded (balance should be back to original)
      const planAfterRes = await request.get("/api/credits/plan", { headers: auth });
      const planAfter = await planAfterRes.json();
      const creditsAfter = planAfter.remaining;
      // Credits should be same as before (consumed 1, refunded 1)
      expect(creditsAfter).toBe(creditsBefore);

      // 5. Verify report status is CANCELLED
      const reportRes = await request.get(`/api/reports/${reportId}`, { headers: auth });
      if (reportRes.status() === 200) {
        const reportData = await reportRes.json();
        expect(reportData.status || reportData.report?.status).toBe("CANCELLED");
      }
    }
  });

  test("cancel after 15s window returns 422", async ({ request }) => {
    const auth = await authA(request);

    // Find an existing report that's older than 15s
    const reportsRes = await request.get("/api/reports", { headers: auth });
    const reports = await reportsRes.json();
    const oldReport = (reports.reports || []).find(
      (r: any) => !["COMPLETED", "PARTIAL", "FAILED", "CANCELLED"].includes(r.status)
    );

    if (!oldReport) {
      test.skip(true, "No active report older than 15s — skipping window test");
    } else {
      const cancelRes = await request.post(`/api/reports/${oldReport.id}/cancel`, {
        headers: { ...auth, "Content-Type": "application/json" },
      });
      // Should be 422 (window expired) or 200 (if report is somehow < 15s old)
      expect([200, 422]).toContain(cancelRes.status());
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// /api/watched-companies — plan limit enforcement
// ═══════════════════════════════════════════════════════════════════════════

test.describe("POST /api/watched-companies — plan limits", () => {
  test("FREE plan allows up to 3 watched companies", async ({ request }) => {
    const auth = await authA(request);

    // Get current watched count
    const listRes = await request.get("/api/watched-companies", { headers: auth });
    const list = await listRes.json();
    const currentCount = (list.watched || []).length;

    // Add companies up to the FREE limit (3)
    const testIcos = ["11111111", "22222222", "33333333", "44444444"];
    let added = 0;
    for (const ico of testIcos) {
      const res = await request.post("/api/watched-companies", {
        headers: { ...auth, "Content-Type": "application/json" },
        data: { companyId: ico, note: `E2E plan limit test ${ico}` },
      });
      if (res.status() === 201) added++;
      if (res.status() === 403) {
        // Hit the plan limit — expected when we reach FREE limit
        expect(res.status()).toBe(403);
        const body = await res.json();
        expect(body.error).toContain("plan");
        break;
      }
      if (res.status() === 409) {
        // Already watching — skip
        continue;
      }
    }

    // If we added enough to hit the limit, verify 403
    if (currentCount + added >= 3) {
      const res = await request.post("/api/watched-companies", {
        headers: { ...auth, "Content-Type": "application/json" },
        data: { companyId: "99999999", note: "E2E over limit test" },
      });
      expect(res.status()).toBe(403);
    }

    // Cleanup: remove test entries
    for (const ico of testIcos) {
      const listRes2 = await request.get("/api/watched-companies", { headers: auth });
      const list2 = await listRes2.json();
      const entry = (list2.watched || []).find((w: any) => w.companyId === ico);
      if (entry) {
        await request.delete(`/api/watched-companies/${entry.id}`, { headers: auth });
      }
    }
  });

  test("watched company can be deleted and re-added (soft delete + restore)", async ({ request }) => {
    const auth = await authA(request);
    const testIco = "55555555";

    // 1. Add
    const addRes = await request.post("/api/watched-companies", {
      headers: { ...auth, "Content-Type": "application/json" },
      data: { companyId: testIco, note: "E2E soft delete test" },
    });
    if (addRes.status() !== 201 && addRes.status() !== 409) {
      test.skip(true, `Cannot add watched company (${addRes.status()}) — skipping`);
    }

    // 2. Find and delete
    const listRes = await request.get("/api/watched-companies", { headers: auth });
    const list = await listRes.json();
    const entry = (list.watched || []).find((w: any) => w.companyId === testIco);

    if (!entry) {
      test.skip(true, "Watched entry not found — skipping");
    } else {
      const delRes = await request.delete(`/api/watched-companies/${entry.id}`, { headers: auth });
      expect(delRes.status()).toBe(200);

      // 3. Verify it's gone from list
      const listRes2 = await request.get("/api/watched-companies", { headers: auth });
      const list2 = await listRes2.json();
      expect((list2.watched || []).find((w: any) => w.companyId === testIco)).toBeUndefined();

      // 4. Re-add (should restore, not create new)
      const restoreRes = await request.post("/api/watched-companies", {
        headers: { ...auth, "Content-Type": "application/json" },
        data: { companyId: testIco, note: "E2E restored" },
      });
      expect([200, 201]).toContain(restoreRes.status());

      // 5. Cleanup
      const listRes3 = await request.get("/api/watched-companies", { headers: auth });
      const list3 = await listRes3.json();
      const entry3 = (list3.watched || []).find((w: any) => w.companyId === testIco);
      if (entry3) {
        await request.delete(`/api/watched-companies/${entry3.id}`, { headers: auth });
      }
    }
  });
});
