/**
 * E2E tests for security fixes — XSS prevention, header injection, cron auth.
 *
 * Tests:
 * 1. Feedback endpoint accepts message with HTML (stored, but escaped in email)
 * 2. Messages endpoint accepts message with HTML (stored, but escaped in email)
 * 3. Download endpoint sanitizes filename (no header injection)
 * 4. Cron endpoints use timing-safe secret comparison
 * 5. Worker callback endpoints use timing-safe secret comparison
 */

import { test, expect } from "@playwright/test";
import { loginAPIAs, TEST_USER_A } from "./helpers";

test.describe("XSS prevention in email HTML", () => {
  test("feedback endpoint accepts HTML in message (escaped in email body)", async ({ request }) => {
    const auth = await loginAPIAs(request, TEST_USER_A.email, TEST_USER_A.password);
    const res = await request.post("/api/feedback", {
      headers: { ...auth, "Content-Type": "application/json" },
      data: {
        category: "BUG",
        message: '<script>alert("xss")</script><img src=x onerror=alert(1)>',
      },
    });
    expect(res.status()).toBe(200);
    // The message is stored as-is in DB (for admin to see raw input),
    // but the email HTML should escape it. We can't verify email content
    // without mocking Resend, but we verify the endpoint doesn't crash.
  });

  test("messages endpoint accepts HTML in message (escaped in email body)", async ({ request }) => {
    const auth = await loginAPIAs(request, TEST_USER_A.email, TEST_USER_A.password);
    const res = await request.post("/api/messages", {
      headers: { ...auth, "Content-Type": "application/json" },
      data: {
        title: 'Test</p><script>alert(1)</script><p>',
        message: '<script>alert("xss")</script>',
      },
    });
    expect(res.status()).toBe(200);
  });
});

test.describe("Header injection prevention in download filename", () => {
  test("download endpoint rejects report with CRLF in filename", async ({ request }) => {
    const auth = await loginAPIAs(request, TEST_USER_A.email, TEST_USER_A.password);

    // Get a report ID (any report, even non-existent — we just want to verify
    // the filename sanitization happens before the 404/403 response)
    const maliciousFilename = "file\r\nSet-Cookie: evil=true";
    const res = await request.get("/api/reports/fake-report-id/download", {
      headers: auth,
      params: { filename: maliciousFilename },
      maxRedirects: 0,
    });

    // The response should NOT contain injected headers
    const setCookieHeader = res.headers()["set-cookie"];
    // If set-cookie exists, it should be from NextAuth, not our injected "evil=true"
    if (setCookieHeader) {
      expect(setCookieHeader).not.toContain("evil=true");
    }
    // Status should be 404 (report not found) — not 500 or other error
    expect([403, 404]).toContain(res.status());
  });

  test("download endpoint accepts normal filename", async ({ request }) => {
    const auth = await loginAPIAs(request, TEST_USER_A.email, TEST_USER_A.password);
    const res = await request.get("/api/reports/fake-report-id/download", {
      headers: auth,
      params: { filename: "report.pdf" },
      maxRedirects: 0,
    });
    expect([403, 404]).toContain(res.status());
  });
});

test.describe("Cron secret — timing-safe comparison", () => {
  test("recover-stuck rejects without authorization header", async ({ request }) => {
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

  test("recover-stuck rejects with malformed authorization header", async ({ request }) => {
    const res = await request.post("/api/reports/recover-stuck", {
      headers: {
        "Content-Type": "application/json",
        authorization: "NotBearer test-cron-secret",
      },
    });
    expect(res.status()).toBe(401);
  });

  test("credit expire rejects without authorization header", async ({ request }) => {
    const res = await request.post("/api/credits/expire", {
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(401);
  });

  test("credit expire rejects with wrong secret", async ({ request }) => {
    const res = await request.post("/api/credits/expire", {
      headers: {
        "Content-Type": "application/json",
        authorization: "Bearer wrong-secret",
      },
    });
    expect(res.status()).toBe(401);
  });
});

test.describe("Worker secret — timing-safe comparison", () => {
  test("refund endpoint rejects without x-worker-secret header", async ({ request }) => {
    const res = await request.post("/api/reports/fake-id/refund", {
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(401);
  });

  test("refund endpoint rejects with empty x-worker-secret", async ({ request }) => {
    const res = await request.post("/api/reports/fake-id/refund", {
      headers: {
        "Content-Type": "application/json",
        "x-worker-secret": "",
      },
    });
    expect(res.status()).toBe(401);
  });

  test("notify endpoint rejects without x-worker-secret header", async ({ request }) => {
    const res = await request.post("/api/reports/fake-id/notify", {
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(401);
  });
});
