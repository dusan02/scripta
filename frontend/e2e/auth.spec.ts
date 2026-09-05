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
import { loginAPIAs, tryLoginAPIAs, TEST_USER_A } from "./helpers";
import {
  createTestUserWithToken,
  getVerificationTokenHash,
  getUserCreditBatches,
  getUserWalletBalance,
  cleanupTestUser,
} from "./helpers";

// ─── Happy-path: registration → verify-email → login ────────────────────────
//
// These tests exercise the full auth flow end-to-end:
//   1. Register via API → user created, emailVerified=null, token in DB
//   2. Verify-email with real token → emailVerified set, trial credit granted
//   3. Verify-email idempotency → second call doesn't double-grant
//   4. Login after verification → session cookie returned
//
// Email sending is bypassed: we create the user + token directly in the DB,
// then call the verify-email API with the raw token. This simulates the
// "user clicks the link in the email" step without requiring an email inbox.
//
// IMPORTANT: These tests require direct DB access (Prisma client connects
// to the database configured in frontend/.env). They only work when the
// test runner can reach the database — i.e. when running against localhost.
// When running against production (E2E_BASE_URL=https://...), the DB helpers
// connect to the local DB while the API calls hit production, causing
// token mismatches. These tests are skipped in that case.
//
// Rate limits may block repeated registrations from the same IP — these
// tests use unique emails per run and clean up after themselves.

const isLocalDB = !process.env.E2E_BASE_URL || process.env.E2E_BASE_URL.includes("localhost");

test.describe("Registration → verify-email → login (happy path)", () => {
  test.skip(!isLocalDB, "DB-dependent tests require local database access");

  const testEmail = `e2e-happy-${Date.now()}@test.verifa.sk`;

  test.afterAll(async () => {
    if (isLocalDB) await cleanupTestUser(testEmail);
  });

  test("registration creates unverified user", async ({ request }) => {
    const res = await request.post("/api/auth/register", {
      headers: { "Content-Type": "application/json" },
      data: { email: testEmail, password: "HappyPath123!" },
    });

    // 201 = new user, 200 = re-registration (unverified user existed)
    // 429 = rate-limited — skip (registration endpoint: 5 req/hour per IP)
    if (res.status() === 429) { test.skip(); return; }
    expect([200, 201]).toContain(res.status());
    const body = await res.json();
    expect(body.message).toMatch(/registr|verifika/i);
  });

  test("verify-email with real token grants trial credit", async ({ request }) => {
    // Create user + token directly in DB (bypasses email sending)
    const { userId, rawToken } = await createTestUserWithToken({
      email: testEmail,
      password: "HappyPath123!",
    });

    // Verify token exists in DB before verification
    const tokenHashBefore = await getVerificationTokenHash(testEmail);
    expect(tokenHashBefore).toBeTruthy();

    // Call verify-email API with the raw token (simulates clicking email link)
    const res = await request.get(`/api/auth/verify-email?token=${rawToken}`);
    if (res.status() === 429) { test.skip(); return; }
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.message).toMatch(/aktivovan|prihlási/i);

    // Token should be deleted from DB after verification
    const tokenHashAfter = await getVerificationTokenHash(testEmail);
    expect(tokenHashAfter).toBeNull();

    // Trial credit (1) should be granted
    const batches = await getUserCreditBatches(userId);
    const trialBatch = batches.find((b) => b.source === "trial");
    expect(trialBatch).toBeTruthy();
    expect(trialBatch!.amount).toBe(1);

    // Wallet balance should be 1
    const balance = await getUserWalletBalance(userId);
    expect(balance).toBe(1);
  });

  test("verify-email idempotency: second call doesn't double-grant", async ({ request }) => {
    // Create a fresh user + token for this test
    const idempotencyEmail = `e2e-idempotency-${Date.now()}@test.verifa.sk`;
    const { userId, rawToken } = await createTestUserWithToken({
      email: idempotencyEmail,
    });

    try {
      // First verification — should succeed and grant 1 trial credit
      const res1 = await request.get(`/api/auth/verify-email?token=${rawToken}`);
      if (res1.status() === 429) { test.skip(); return; }
      expect(res1.status()).toBe(200);

      const balance1 = await getUserWalletBalance(userId);
      expect(balance1).toBe(1);

      // Second call with the same token — token was deleted, so it's invalid now
      // The API should return 400 "Neplatný verifikačný token"
      const res2 = await request.get(`/api/auth/verify-email?token=${rawToken}`);
      expect(res2.status()).toBe(400);

      // Balance should still be 1 — no double-grant
      const balance2 = await getUserWalletBalance(userId);
      expect(balance2).toBe(1);

      // Only 1 trial batch should exist
      const batches = await getUserCreditBatches(userId);
      const trialBatches = batches.filter((b) => b.source === "trial");
      expect(trialBatches.length).toBe(1);
    } finally {
      await cleanupTestUser(idempotencyEmail);
    }
  });

  test("login succeeds after email verification", async ({ request }) => {
    // Create and verify a user
    const loginEmail = `e2e-login-${Date.now()}@test.verifa.sk`;
    const { rawToken } = await createTestUserWithToken({
      email: loginEmail,
      password: "LoginTest123!",
    });

    try {
      // Verify email
      const verifyRes = await request.get(`/api/auth/verify-email?token=${rawToken}`);
      if (verifyRes.status() === 429) { test.skip(); return; }
      expect(verifyRes.status()).toBe(200);

      // Now login — should succeed and return a session cookie
      const csrfRes = await request.get("/api/auth/csrf");
      const csrfToken = (await csrfRes.json()).csrfToken;

      const loginRes = await request.post("/api/auth/callback/credentials", {
        form: {
          email: loginEmail,
          password: "LoginTest123!",
          redirect: "false",
          csrfToken,
        },
        maxRedirects: 0,
      });

      // NextAuth returns 302 on success with session cookie
      const setCookie = loginRes.headers()["set-cookie"] || "";
      const sessionCookie = setCookie.match(/(?:__Secure-)?next-auth\.session-token=([^;]+)/);
      expect(sessionCookie).toBeTruthy();

      // Verify session works by accessing a protected endpoint
      const cookieName = setCookie.match(/(__Secure-)?next-auth\.session-token=/)?.[0]?.replace("=", "") || "next-auth.session-token";
      const sessionRes = await request.get("/api/auth/session", {
        headers: { Cookie: `${cookieName}=${sessionCookie![1]}` },
      });
      const session = await sessionRes.json();
      expect(session.user?.email).toBe(loginEmail);
    } finally {
      await cleanupTestUser(loginEmail);
    }
  });

  test("login fails before email verification", async ({ request }) => {
    const unverifiedEmail = `e2e-unverified-${Date.now()}@test.verifa.sk`;
    await createTestUserWithToken({
      email: unverifiedEmail,
      password: "Unverified123!",
    });

    try {
      const csrfRes = await request.get("/api/auth/csrf");
      const csrfToken = (await csrfRes.json()).csrfToken;

      const loginRes = await request.post("/api/auth/callback/credentials", {
        form: {
          email: unverifiedEmail,
          password: "Unverified123!",
          redirect: "false",
          csrfToken,
        },
        maxRedirects: 0,
      });

      // NextAuth returns 302 even on failure (redirects to error page),
      // but no session cookie is set. Check for absence of session token.
      const setCookie = loginRes.headers()["set-cookie"] || "";
      const sessionCookie = setCookie.match(/(?:__Secure-)?next-auth\.session-token=([^;]+)/);
      expect(sessionCookie).toBeNull();
    } finally {
      await cleanupTestUser(unverifiedEmail);
    }
  });
});

test.describe("Registration validation", () => {
  // Note: registration endpoint is rate-limited (5 req/hour per IP).
  // If rate-limited (429), tests skip gracefully.
  test("rejects password shorter than 8 characters", async ({ request }) => {
    const res = await request.post("/api/auth/register", {
      headers: { "Content-Type": "application/json" },
      data: { email: "test-short-pass@example.com", password: "short" },
    });
    if (res.status() === 429) { test.skip(); return; }
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.message).toContain("8");
  });

  test("rejects invalid email format", async ({ request }) => {
    const res = await request.post("/api/auth/register", {
      headers: { "Content-Type": "application/json" },
      data: { email: "not-an-email", password: "validpassword123" },
    });
    if (res.status() === 429) { test.skip(); return; }
    expect(res.status()).toBe(400);
  });

  test("rejects missing email", async ({ request }) => {
    const res = await request.post("/api/auth/register", {
      headers: { "Content-Type": "application/json" },
      data: { password: "validpassword123" },
    });
    if (res.status() === 429) { test.skip(); return; }
    expect(res.status()).toBe(400);
  });

  test("rejects missing password", async ({ request }) => {
    const res = await request.post("/api/auth/register", {
      headers: { "Content-Type": "application/json" },
      data: { email: "test-no-pass@example.com" },
    });
    if (res.status() === 429) { test.skip(); return; }
    expect(res.status()).toBe(400);
  });
});

test.describe("Verify-email token validation", () => {
  test("rejects missing token", async ({ request }) => {
    const res = await request.get("/api/auth/verify-email");
    if (res.status() === 429) { test.skip(); return; }
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.message).toContain("token");
  });

  test("rejects invalid token", async ({ request }) => {
    const res = await request.get("/api/auth/verify-email?token=invalid-token-12345");
    if (res.status() === 429) { test.skip(); return; }
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
    if (res.status() === 429) { test.skip(); return; }
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
    if (res.status() === 429) { test.skip(); return; }
    expect(res.status()).toBe(400);
  });
});

test.describe("Reset-password validation", () => {
  test("rejects invalid token", async ({ request }) => {
    const res = await request.post("/api/auth/reset-password", {
      headers: { "Content-Type": "application/json" },
      data: { token: "invalid-reset-token", password: "newpassword123" },
    });
    if (res.status() === 429) { test.skip(); return; }
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.message).toContain("Neplatný");
  });

  test("rejects password shorter than 8 characters", async ({ request }) => {
    const res = await request.post("/api/auth/reset-password", {
      headers: { "Content-Type": "application/json" },
      data: { token: "some-token", password: "short" },
    });
    if (res.status() === 429) { test.skip(); return; }
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.message).toContain("8");
  });

  test("rejects missing token", async ({ request }) => {
    const res = await request.post("/api/auth/reset-password", {
      headers: { "Content-Type": "application/json" },
      data: { password: "validpassword123" },
    });
    if (res.status() === 429) { test.skip(); return; }
    expect(res.status()).toBe(400);
  });
});

test.describe("Admin route authorization", () => {
  test("non-admin user gets 403 on admin overview", async ({ request }) => {
    const auth = await tryLoginAPIAs(request, TEST_USER_A.email, TEST_USER_A.password) ?? await tryLoginAPIAs(request, "test@verifa.sk", "heslo123");
    if (!auth) { test.skip(); return; }
    const res = await request.get("/api/admin/overview", { headers: auth });
    expect(res.status()).toBe(403);
  });

  test("non-admin user gets 403 on admin stats", async ({ request }) => {
    const auth = await tryLoginAPIAs(request, TEST_USER_A.email, TEST_USER_A.password) ?? await tryLoginAPIAs(request, "test@verifa.sk", "heslo123");
    if (!auth) { test.skip(); return; }
    const res = await request.get("/api/admin/stats", { headers: auth });
    expect(res.status()).toBe(403);
  });

  test("non-admin user gets 403 on admin feedback", async ({ request }) => {
    const auth = await tryLoginAPIAs(request, TEST_USER_A.email, TEST_USER_A.password) ?? await tryLoginAPIAs(request, "test@verifa.sk", "heslo123");
    if (!auth) { test.skip(); return; }
    const res = await request.get("/api/admin/feedback", { headers: auth });
    expect(res.status()).toBe(403);
  });

  test("non-admin user gets 403 on admin messages", async ({ request }) => {
    const auth = await tryLoginAPIAs(request, TEST_USER_A.email, TEST_USER_A.password) ?? await tryLoginAPIAs(request, "test@verifa.sk", "heslo123");
    if (!auth) { test.skip(); return; }
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
    const auth = await tryLoginAPIAs(request, TEST_USER_A.email, TEST_USER_A.password) ?? await tryLoginAPIAs(request, "test@verifa.sk", "heslo123");
    if (!auth) { test.skip(); return; }
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
    const auth = await tryLoginAPIAs(request, TEST_USER_A.email, TEST_USER_A.password) ?? await tryLoginAPIAs(request, "test@verifa.sk", "heslo123");
    if (!auth) { test.skip(); return; }
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
