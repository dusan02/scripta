/**
 * E2E tests for report authorization and IDOR protection.
 *
 * These tests verify that:
 * 1. Unauthenticated users cannot access report endpoints
 * 2. Users cannot access other users' reports (IDOR)
 * 3. Download endpoint requires ownership
 * 4. Export-csv endpoint requires ownership
 * 5. Worker callback endpoints require WORKER_SECRET
 *
 * Prerequisites:
 * - A running Next.js dev server with a test database
 * - At least two test users with different reports
 * - WORKER_SECRET set in .env
 */

import { test, expect } from "@playwright/test";
import { loginAPIAs, TEST_USER_A, TEST_USER_B } from "./helpers";

test.describe("Report authorization — IDOR protection", () => {
  test("unauthenticated request to /api/reports returns 401", async ({ request }) => {
    const res = await request.get("/api/reports");
    expect(res.status()).toBe(401);
  });

  test("unauthenticated request to /api/reports/[id] returns 401", async ({ request }) => {
    const res = await request.get("/api/reports/fake-report-id");
    expect(res.status()).toBe(401);
  });

  test("unauthenticated download returns 401", async ({ request }) => {
    const res = await request.get("/api/reports/fake-report-id/download");
    expect(res.status()).toBe(401);
  });

  test("unauthenticated export-csv returns 401", async ({ request }) => {
    const res = await request.get("/api/reports/fake-report-id/export-csv");
    expect(res.status()).toBe(401);
  });

  test("unauthenticated DELETE returns 401", async ({ request }) => {
    const res = await request.delete("/api/reports?id=fake-report-id");
    expect(res.status()).toBe(401);
  });
});

test.describe("Worker callback endpoints — secret verification", () => {
  const WORKER_SECRET = process.env.WORKER_SECRET || "test-worker-secret";

  test("refund endpoint rejects without secret", async ({ request }) => {
    const res = await request.post("/api/reports/fake-id/refund", {
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(401);
  });

  test("refund endpoint rejects with wrong secret", async ({ request }) => {
    const res = await request.post("/api/reports/fake-id/refund", {
      headers: {
        "Content-Type": "application/json",
        "x-worker-secret": "wrong-secret",
      },
    });
    expect(res.status()).toBe(401);
  });

  test("notify endpoint rejects without secret", async ({ request }) => {
    const res = await request.post("/api/reports/fake-id/notify", {
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(401);
  });

  test("notify endpoint rejects with wrong secret", async ({ request }) => {
    const res = await request.post("/api/reports/fake-id/notify", {
      headers: {
        "Content-Type": "application/json",
        "x-worker-secret": "wrong-secret",
      },
    });
    expect(res.status()).toBe(401);
  });

  test("refund endpoint accepts with correct secret (returns 404 for fake report)", async ({ request }) => {
    const res = await request.post("/api/reports/nonexistent-report-id/refund", {
      headers: {
        "Content-Type": "application/json",
        "x-worker-secret": WORKER_SECRET,
      },
    });
    // Should pass auth but return 404 for non-existent report
    expect(res.status()).toBe(404);
  });

  test("notify endpoint accepts with correct secret (returns 404 for fake report)", async ({ request }) => {
    const res = await request.post("/api/reports/nonexistent-report-id/notify", {
      headers: {
        "Content-Type": "application/json",
        "x-worker-secret": WORKER_SECRET,
      },
    });
    // Should pass auth but return 404 for non-existent report
    expect(res.status()).toBe(404);
  });
});

test.describe("Cron endpoints — secret verification", () => {
  const CRON_SECRET = process.env.CRON_SECRET || "test-cron-secret";

  test("recover-stuck rejects without secret", async ({ request }) => {
    const res = await request.post("/api/reports/recover-stuck", {
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(401);
  });

  test("recover-stuck rejects with wrong secret", async ({ request }) => {
    const res = await request.post("/api/reports/recover-stuck", {
      headers: {
        "Content-Type": "application/json",
        authorization: "Bearer wrong-secret",
      },
    });
    expect(res.status()).toBe(401);
  });

  test("recover-stuck accepts with correct secret", async ({ request }) => {
    const res = await request.post("/api/reports/recover-stuck", {
      headers: {
        "Content-Type": "application/json",
        authorization: `Bearer ${CRON_SECRET}`,
      },
    });
    // Should return 200 with recovery stats (even if 0 reports recovered)
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("stuckRecovered");
    expect(body).toHaveProperty("missedRefundsProcessed");
  });

  test("credit expire cron rejects without secret", async ({ request }) => {
    const res = await request.post("/api/credits/expire", {
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(401);
  });

  test("credit expire cron accepts with correct secret", async ({ request }) => {
    const res = await request.post("/api/credits/expire", {
      headers: {
        "Content-Type": "application/json",
        authorization: `Bearer ${CRON_SECRET}`,
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("expiredCredits");
    expect(body).toHaveProperty("zeroedCredits");
  });
});

test.describe("IDOR — cross-user access prevention", () => {
  // These tests verify that User B cannot access User A's reports.
  // They require both test users to be seeded (npm run prisma:seed).

  test("User B cannot view User A's report (GET /api/reports/[id])", async ({ request }) => {
    // Login as User A and create a report to get a real report ID.
    const authA = await loginAPIAs(request, TEST_USER_A.email, TEST_USER_A.password);
    const listRes = await request.get("/api/reports", { headers: authA });
    const listBody = await listRes.json();

    // If User A has no reports, create one (will fail at worker health check,
    // but the DB record is created — good enough for IDOR testing).
    let reportId: string;
    if (listBody.reports && listBody.reports.length > 0) {
      reportId = listBody.reports[0].id;
    } else {
      // Try to create a report — may return 503 if worker is offline,
      // but if it returns 201, we have a real report ID.
      const createRes = await request.post("/api/reports", {
        headers: { ...authA, "Content-Type": "application/json" },
        data: { targetType: "COMPANY", ico: "12345678", sources: ["ORSR"] },
      });
      if (createRes.status() === 201) {
        const createBody = await createRes.json();
        reportId = createBody.reportRequestId;
      } else {
        // No reports available and can't create one — skip this test.
        test.skip(true, "No reports available for User A and worker is offline");
        return;
      }
    }

    // Login as User B and try to access User A's report.
    const authB = await loginAPIAs(request, TEST_USER_B.email, TEST_USER_B.password);
    const res = await request.get(`/api/reports/${reportId}`, { headers: authB });
    expect(res.status()).toBe(403);
  });

  test("User B cannot download User A's report", async ({ request }) => {
    const authA = await loginAPIAs(request, TEST_USER_A.email, TEST_USER_A.password);
    const listRes = await request.get("/api/reports", { headers: authA });
    const listBody = await listRes.json();

    if (!listBody.reports || listBody.reports.length === 0) {
      test.skip(true, "No reports available for User A");
      return;
    }

    const reportId = listBody.reports[0].id;
    const authB = await loginAPIAs(request, TEST_USER_B.email, TEST_USER_B.password);
    const res = await request.get(`/api/reports/${reportId}/download`, {
      headers: authB,
      maxRedirects: 0, // Don't follow 302 — we want to check the status
    });
    expect(res.status()).toBe(403);
  });

  test("User B cannot export-csv of User A's report", async ({ request }) => {
    const authA = await loginAPIAs(request, TEST_USER_A.email, TEST_USER_A.password);
    const listRes = await request.get("/api/reports", { headers: authA });
    const listBody = await listRes.json();

    if (!listBody.reports || listBody.reports.length === 0) {
      test.skip(true, "No reports available for User A");
      return;
    }

    const reportId = listBody.reports[0].id;
    const authB = await loginAPIAs(request, TEST_USER_B.email, TEST_USER_B.password);
    const res = await request.get(`/api/reports/${reportId}/export-csv`, { headers: authB });
    expect(res.status()).toBe(403);
  });

  test("User B cannot delete User A's report", async ({ request }) => {
    const authA = await loginAPIAs(request, TEST_USER_A.email, TEST_USER_A.password);
    const listRes = await request.get("/api/reports", { headers: authA });
    const listBody = await listRes.json();

    if (!listBody.reports || listBody.reports.length === 0) {
      test.skip(true, "No reports available for User A");
      return;
    }

    const reportId = listBody.reports[0].id;
    const authB = await loginAPIAs(request, TEST_USER_B.email, TEST_USER_B.password);
    const res = await request.delete(`/api/reports?id=${reportId}`, { headers: authB });
    expect(res.status()).toBe(403);
  });

  test("User B cannot cancel User A's report", async ({ request }) => {
    const authA = await loginAPIAs(request, TEST_USER_A.email, TEST_USER_A.password);
    const listRes = await request.get("/api/reports", { headers: authA });
    const listBody = await listRes.json();

    if (!listBody.reports || listBody.reports.length === 0) {
      test.skip(true, "No reports available for User A");
      return;
    }

    const reportId = listBody.reports[0].id;
    const authB = await loginAPIAs(request, TEST_USER_B.email, TEST_USER_B.password);
    const res = await request.post(`/api/reports/${reportId}/cancel`, {
      headers: { ...authB, "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(403);
  });
});
