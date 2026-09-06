/**
 * Security regression test for CVE-2025-29927 (Next.js middleware auth bypass).
 *
 * Before Next.js 14.2.25, sending `x-middleware-subrequest: middleware` (or
 * similar values) caused Next.js to skip middleware execution entirely,
 * letting unauthenticated users reach protected pages.
 *
 * Tests:
 * 1. Unauthenticated request to protected routes → redirect to /login
 * 2. Unauthenticated request WITH x-middleware-subrequest header → still redirect
 *    (the bypass must NOT work — this is the regression check)
 * 3. Authenticated request to protected routes → not redirected (sanity)
 * 4. API authorization is independent of middleware (401 without session,
 *    401 with bypass header — API routes have their own auth)
 */

import { test, expect } from "@playwright/test";
import { loginAPIAs, TEST_USER_A } from "./helpers";

const PROTECTED_ROUTES = ["/dashboard", "/reports", "/settings"];

// Header values that triggered CVE-2025-29927 across Next.js versions.
// `middleware` is the classic one; the others target alternate build layouts.
// The 5x-repeated form is the confirmed working exploit against this app's
// layout (src/middleware.ts) on Next.js 14.2.4 — verified to return 200
// (bypassed) before the upgrade to 14.2.35.
const BYPASS_HEADER_VALUES = [
  "middleware",
  "src/middleware",
  "pages/_middleware",
  "middleware.js",
  "middleware:middleware:middleware:middleware:middleware",
  "src/middleware:src/middleware:src/middleware:src/middleware:src/middleware",
];

/** Assert the response is a redirect to /login (middleware ran). */
function expectLoginRedirect(res: { status(): number; headers(): Record<string, string> }, label: string) {
  const status = res.status();
  const location = res.headers()["location"] || "";
  expect(
    [302, 307, 308].includes(status) && location.includes("/login"),
    `${label}: expected redirect to /login, got ${status} → ${location}`
  ).toBe(true);
}

test.describe("CVE-2025-29927 — middleware auth bypass regression", () => {
  test("unauthenticated request to protected routes redirects to /login", async ({ request }) => {
    for (const route of PROTECTED_ROUTES) {
      const res = await request.get(route, { maxRedirects: 0 });
      expectLoginRedirect(res, `GET ${route} (no auth)`);
    }
  });

  for (const headerValue of BYPASS_HEADER_VALUES) {
    test(`bypass header "x-middleware-subrequest: ${headerValue}" does NOT skip middleware`, async ({ request }) => {
      for (const route of PROTECTED_ROUTES) {
        const res = await request.get(route, {
          headers: { "x-middleware-subrequest": headerValue },
          maxRedirects: 0,
        });
        // If the bypass worked, status would be 200 (protected page rendered).
        // It must still redirect to /login.
        expectLoginRedirect(res, `GET ${route} with bypass header`);
      }
    });
  }

  test("authenticated request to protected routes is not redirected to /login (sanity)", async ({ request }) => {
    const auth = await loginAPIAs(request, TEST_USER_A.email, TEST_USER_A.password);
    for (const route of PROTECTED_ROUTES) {
      const res = await request.get(route, { headers: auth, maxRedirects: 0 });
      const location = res.headers()["location"] || "";
      expect(
        !location.includes("/login"),
        `${route}: authenticated user should not be sent to /login (got ${res.status()} → ${location})`
      ).toBe(true);
    }
  });

  test("API authorization is independent of middleware (matcher excludes /api)", async ({ request }) => {
    // Middleware never runs on /api/* — route handlers must check auth themselves.
    // 1. Without session → 401
    const noAuth = await request.get("/api/reports");
    expect([401, 302, 307]).toContain(noAuth.status());

    // 2. With bypass header → same status (header must not affect API auth)
    const bypass = await request.get("/api/reports", {
      headers: { "x-middleware-subrequest": "middleware" },
    });
    expect(bypass.status()).toBe(noAuth.status());

    // 3. With session → 200
    const auth = await loginAPIAs(request, TEST_USER_A.email, TEST_USER_A.password);
    const authed = await request.get("/api/reports", { headers: auth });
    expect(authed.status()).toBe(200);
  });
});
