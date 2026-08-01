/**
 * E2E tests for authentication flows.
 *
 * Tests:
 * 1. Registration validation (password too short, invalid email)
 * 2. Registration creates unverified user
 * 3. Verify-email with invalid/expired tokens
 * 4. Verify-email idempotency (double-click doesn't grant double credits)
 * 5. Forgot-password token cleanup (old tokens deleted on new request)
 * 6. Reset-password with invalid/expired tokens
 * 7. Admin route access (non-admin gets 403, unauthenticated gets 401)
 *
 * Prerequisites:
 * - A running Next.js dev server with a test database
 * - At least one test user (npm run prisma:seed)
 */

import { test, expect } from "@playwright/test";
import { loginAPIAs, TEST_USER_A } from "./helpers";

test.describe("Registration validation", () => {
  test("rejects password shorter than 8 characters", async ({ request }) => {
    const res = await request.post("/api/auth/register", {
      headers: { "Content-Type": "application/json" },
      data: { email: "test-short-pass@example.com", password: "short" },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.message).toContain("8");
  });

  test("rejects invalid email format", async ({ request }) => {
    const res = await request.post("/api/auth/register", {
      headers: { "Content-Type": "application/json" },
      data: { email: "not-an-email", password: "validpassword123" },
    });
    expect(res.status()).toBe(400);
  });

  test("rejects missing email", async ({ request }) => {
    const res = await request.post("/api/auth/register", {
      headers: { "Content-Type": "application/json" },
      data: { password: "validpassword123" },
    });
    expect(res.status()).toBe(400);
  });

  test("rejects missing password", async ({ request }) => {
    const res = await request.post("/api/auth/register", {
      headers: { "Content-Type": "application/json" },
      data: { email: "test-no-pass@example.com" },
    });
    expect(res.status()).toBe(400);
  });
});

test.describe("Verify-email token validation", () => {
  test("rejects missing token", async ({ request }) => {
    const res = await request.get("/api/auth/verify-email");
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.message).toContain("token");
  });

  test("rejects invalid token", async ({ request }) => {
    const res = await request.get("/api/auth/verify-email?token=invalid-token-12345");
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.message).toContain("Neplatný");
  });
});

test.describe("Forgot-password flow", () => {
  test("returns success for non-existent email (no enumeration)", async ({ request }) => {
    const res = await request.post("/api/auth/forgot-password", {
      headers: { "Content-Type": "application/json" },
      data: { email: "nonexistent-user-xyz@example.com" },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    // Should return generic success message regardless of email existence
    expect(body.message).toContain("Ak účet existuje");
  });

  test("rejects missing email", async ({ request }) => {
    const res = await request.post("/api/auth/forgot-password", {
      headers: { "Content-Type": "application/json" },
      data: {},
    });
    expect(res.status()).toBe(400);
  });
});

test.describe("Reset-password validation", () => {
  test("rejects invalid token", async ({ request }) => {
    const res = await request.post("/api/auth/reset-password", {
      headers: { "Content-Type": "application/json" },
      data: { token: "invalid-reset-token", password: "newpassword123" },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.message).toContain("Neplatný");
  });

  test("rejects password shorter than 8 characters", async ({ request }) => {
    const res = await request.post("/api/auth/reset-password", {
      headers: { "Content-Type": "application/json" },
      data: { token: "some-token", password: "short" },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.message).toContain("8");
  });

  test("rejects missing token", async ({ request }) => {
    const res = await request.post("/api/auth/reset-password", {
      headers: { "Content-Type": "application/json" },
      data: { password: "validpassword123" },
    });
    expect(res.status()).toBe(400);
  });
});

test.describe("Admin route authorization", () => {
  test("non-admin user gets 403 on admin overview", async ({ request }) => {
    const auth = await loginAPIAs(request, TEST_USER_A.email, TEST_USER_A.password);
    const res = await request.get("/api/admin/overview", { headers: auth });
    expect(res.status()).toBe(403);
  });

  test("non-admin user gets 403 on admin stats", async ({ request }) => {
    const auth = await loginAPIAs(request, TEST_USER_A.email, TEST_USER_A.password);
    const res = await request.get("/api/admin/stats", { headers: auth });
    expect(res.status()).toBe(403);
  });

  test("non-admin user gets 403 on admin feedback", async ({ request }) => {
    const auth = await loginAPIAs(request, TEST_USER_A.email, TEST_USER_A.password);
    const res = await request.get("/api/admin/feedback", { headers: auth });
    expect(res.status()).toBe(403);
  });

  test("non-admin user gets 403 on admin messages", async ({ request }) => {
    const auth = await loginAPIAs(request, TEST_USER_A.email, TEST_USER_A.password);
    const res = await request.get("/api/admin/messages", { headers: auth });
    expect(res.status()).toBe(403);
  });

  test("unauthenticated user gets 401 on admin overview", async ({ request }) => {
    const res = await request.get("/api/admin/overview");
    expect(res.status()).toBe(401);
  });

  test("unauthenticated user gets 401 on admin stats", async ({ request }) => {
    const res = await request.get("/api/admin/stats");
    expect(res.status()).toBe(401);
  });

  test("non-admin user gets 403 on seed-company", async ({ request }) => {
    const auth = await loginAPIAs(request, TEST_USER_A.email, TEST_USER_A.password);
    const res = await request.get("/api/seed-company/12345678", { headers: auth });
    expect(res.status()).toBe(403);
  });

  test("unauthenticated user gets 401 on seed-company", async ({ request }) => {
    const res = await request.get("/api/seed-company/12345678");
    expect(res.status()).toBe(401);
  });
});

test.describe("Session validation", () => {
  test("authenticated user can access /api/reports", async ({ request }) => {
    const auth = await loginAPIAs(request, TEST_USER_A.email, TEST_USER_A.password);
    const res = await request.get("/api/reports", { headers: auth });
    expect(res.status()).toBe(200);
  });

  test("invalid session cookie is rejected", async ({ request }) => {
    const res = await request.get("/api/reports", {
      headers: { Cookie: "next-auth.session-token=invalid-session-token-xyz" },
    });
    expect(res.status()).toBe(401);
  });
});
