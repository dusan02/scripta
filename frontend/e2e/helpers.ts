/**
 * Test helpers for E2E tests.
 *
 * These helpers provide utilities for:
 * - Authenticating test users via the NextAuth credentials flow
 * - Creating test data directly in the database (bypassing API)
 * - Cleaning up test data after tests
 * - Generating mock Stripe webhook events
 */

import { Page, APIRequestContext } from "@playwright/test";

// Test user credentials — must exist in the test database.
// Created via `npm run prisma:seed`.
export const TEST_USER_A = {
  email: "e2e-test@verifa.sk",
  password: "E2eTestPass123!",
  id: "", // Populated after login
};

export const TEST_USER_B = {
  email: "e2e-test-b@verifa.sk",
  password: "E2eTestPass456!",
  id: "", // Populated after login
};

// Alias for backward compatibility
export const TEST_USER = TEST_USER_A;

/**
 * Authenticate via the NextAuth credentials endpoint.
 * Stores the session cookie in the browser context.
 */
export async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="email"]', TEST_USER.email);
  await page.fill('input[name="password"]', TEST_USER.password);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard", { timeout: 15_000 });
}

/**
 * Authenticate via API (for API-level tests that don't need a browser).
 * Returns the session cookies for use in subsequent requests.
 */
export async function loginAPI(request: APIRequestContext): Promise<Record<string, string>> {
  return loginAPIAs(request, TEST_USER_A.email, TEST_USER_A.password);
}

/**
 * Authenticate as a specific user via API.
 * Returns the auth headers for use in subsequent requests.
 */
export async function loginAPIAs(
  request: APIRequestContext,
  email: string,
  password: string
): Promise<Record<string, string>> {
  const csrfToken = await getCsrfToken(request);
  const res = await request.post("/api/auth/callback/credentials", {
    form: {
      email,
      password,
      redirect: "false",
      csrfToken,
    },
    maxRedirects: 0,
  });

  // NextAuth returns a 302 redirect on success. The session cookie is in
  // the Set-Cookie header of the redirect response.
  // On HTTPS (production) the cookie is prefixed with __Secure-
  const setCookie = res.headers()["set-cookie"] || "";
  const sessionCookie = setCookie.match(/(?:__Secure-)?next-auth\.session-token=([^;]+)/);
  if (!sessionCookie) {
    throw new Error(`Login failed for ${email} — no session cookie returned (status: ${res.status()})`);
  }
  // Use the same cookie name that was set by the server
  const cookieName = setCookie.match(/(__Secure-)?next-auth\.session-token=/)?.[0]?.replace("=", "") || "next-auth.session-token";
  return {
    Cookie: `${cookieName}=${sessionCookie[1]}`,
  };
}

async function getCsrfToken(request: APIRequestContext): Promise<string> {
  const res = await request.get("/api/auth/csrf");
  const body = await res.json();
  return body.csrfToken;
}

/**
 * Generate a mock Stripe `charge.refunded` webhook event body.
 * This simulates the raw JSON that Stripe sends to the webhook endpoint.
 */
export function mockChargeRefundedEvent(opts: {
  userId: string;
  chargeId?: string;
  refundId?: string;
  amountCents?: number;
  refundAmountCents?: number;
  metadata?: Record<string, string>;
  invoiceId?: string;
}): string {
  const chargeId = opts.chargeId || `ch_test_${Date.now()}`;
  const refundId = opts.refundId || `re_test_${Date.now()}`;
  const amount = opts.amountCents || 34900; // €349.00
  const refundAmount = opts.refundAmountCents || amount; // Full refund

  return JSON.stringify({
    id: `evt_test_${Date.now()}`,
    object: "event",
    type: "charge.refunded",
    data: {
      object: {
        id: chargeId,
        object: "charge",
        amount,
        amount_refunded: refundAmount,
        metadata: {
          userId: opts.userId,
          planName: "payg50",
          credits: "50",
          ...opts.metadata,
        },
        payment_intent: `pi_test_${Date.now()}`,
        invoice: opts.invoiceId || null,
        refunds: {
          data: [
            {
              id: refundId,
              amount: refundAmount,
            },
          ],
        },
      },
    },
  });
}

/**
 * Generate a mock Stripe `invoice.paid` webhook event body.
 * Used to simulate subscription credit grants.
 */
export function mockInvoicePaidEvent(opts: {
  userId: string;
  invoiceId?: string;
  credits?: number;
  planName?: string;
}): string {
  const invoiceId = opts.invoiceId || `in_test_${Date.now()}`;
  return JSON.stringify({
    id: `evt_test_${Date.now()}`,
    object: "event",
    type: "invoice.paid",
    data: {
      object: {
        id: invoiceId,
        object: "invoice",
        metadata: {
          userId: opts.userId,
          planName: opts.planName || "firma",
          credits: String(opts.credits || 20),
        },
        parent: {
          subscription_details: {
            subscription: `sub_test_${Date.now()}`,
          },
        },
      },
    },
  });
}

/**
 * Generate a mock Stripe `checkout.session.completed` webhook event body.
 * Used to simulate pay-as-you-go credit purchases.
 */
export function mockCheckoutCompletedEvent(opts: {
  userId: string;
  credits?: number;
  planName?: string;
  paymentIntentId?: string;
}): string {
  return JSON.stringify({
    id: `evt_test_${Date.now()}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: `cs_test_${Date.now()}`,
        object: "checkout.session",
        mode: "payment",
        payment_intent: opts.paymentIntentId || `pi_test_${Date.now()}`,
        metadata: {
          userId: opts.userId,
          planName: opts.planName || "payg50",
          credits: String(opts.credits || 50),
        },
      },
    },
  });
}
