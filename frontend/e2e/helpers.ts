/**
 * Test helpers for E2E tests.
 *
 * These helpers provide utilities for:
 * - Authenticating test users via the NextAuth credentials flow
 * - Creating test data directly in the database (bypassing API)
 * - Cleaning up test data after tests
 * - Generating mock Stripe/Paddle webhook events
 */

import { Page, APIRequestContext } from "@playwright/test";
import crypto from "crypto";
import { hashToken } from "@/lib/token";

// ─── Database helpers (direct Prisma access) ────────────────────────────────

/**
 * Lazy-loaded Prisma client for direct DB access in tests.
 * Used for: fetching verification tokens, cleaning up test users, checking
 * credit batches, etc. — operations that bypass the API layer.
 */
let _prisma: any = null;
async function getPrisma() {
  if (!_prisma) {
    const { PrismaClient } = require("@prisma/client");
    _prisma = new PrismaClient();
  }
  return _prisma;
}

/**
 * Create a user directly in the DB with a verification token.
 * Returns { user, rawToken } — the rawToken is what would be in the email link.
 * Useful for testing verify-email flow without an actual email roundtrip.
 */
export async function createTestUserWithToken(opts: {
  email: string;
  password?: string;
}): Promise<{ userId: string; rawToken: string }> {
  const prisma = await getPrisma();
  const bcrypt = require("bcryptjs");
  const passwordHash = await bcrypt.hash(opts.password || "TestPass123!", 10);

  // Delete any existing user with this email
  await prisma.user.deleteMany({ where: { email: opts.email } });

  const user = await prisma.user.create({
    data: { email: opts.email, passwordHash },
  });

  // Create verification token
  await prisma.verificationToken.deleteMany({ where: { email: opts.email } });
  const rawToken = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await prisma.verificationToken.create({
    data: { email: opts.email, token: hashToken(rawToken), expires },
  });

  return { userId: user.id, rawToken };
}

/**
 * Fetch the raw verification token from the DB for a given email.
 * Since we store hashed tokens, this returns the hash — useful for
 * verifying that a token was deleted after verification.
 */
export async function getVerificationTokenHash(email: string): Promise<string | null> {
  const prisma = await getPrisma();
  const record = await prisma.verificationToken.findFirst({
    where: { email },
    select: { token: true },
  });
  return record?.token || null;
}

/**
 * Get a user's credit batches directly from the DB.
 */
export async function getUserCreditBatches(userId: string): Promise<Array<{
  id: string;
  amount: number;
  remaining: number;
  source: string;
  planName: string | null;
}>> {
  const prisma = await getPrisma();
  return prisma.creditBatch.findMany({
    where: { userId },
    select: { id: true, amount: true, remaining: true, source: true, planName: true },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Get user's wallet balance directly from the DB.
 * Returns a number (Prisma returns Decimal, we convert).
 */
export async function getUserWalletBalance(userId: string): Promise<number> {
  const prisma = await getPrisma();
  const wallet = await prisma.wallet.findUnique({
    where: { userId },
    select: { balance: true },
  });
  return Number(wallet?.balance ?? 0);
}

/**
 * Clean up a test user and all related data (credit batches, wallet,
 * verification tokens). Safe to call even if the user doesn't exist.
 */
export async function cleanupTestUser(email: string): Promise<void> {
  const prisma = await getPrisma();
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (user) {
    await prisma.creditBatch.deleteMany({ where: { userId: user.id } });
    await prisma.wallet.deleteMany({ where: { userId: user.id } });
  }
  await prisma.verificationToken.deleteMany({ where: { email } });
  await prisma.user.deleteMany({ where: { email } });
  if (_prisma) await _prisma.$disconnect();
}

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

/**
 * Try to authenticate via API. Returns null if login fails (instead of throwing).
 * Useful for tests that should skip gracefully when the test user doesn't exist
 * in the current database (e.g. local dev without seeded e2e users).
 */
export async function tryLoginAPIAs(
  request: APIRequestContext,
  email: string,
  password: string
): Promise<Record<string, string> | null> {
  try {
    return await loginAPIAs(request, email, password);
  } catch {
    return null;
  }
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

// ─── Paddle helpers ─────────────────────────────────────────────────────────

/**
 * Sign a mock Paddle webhook event body with the webhook secret.
 * Paddle uses HMAC-SHA256 with the format `ts:body` (colon separator).
 * The signature header format is `ts=<timestamp>;h1=<hex>`.
 */
export function signPaddleEvent(
  body: string,
  secret: string,
  timestamp: number = Math.floor(Date.now() / 1000),
): string {
  const crypto = require("crypto");
  const payload = `${timestamp}:${body}`;
  const h1 = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `ts=${timestamp};h1=${h1}`;
}

/**
 * Generate a mock Paddle `transaction.completed` webhook event body.
 *
 * The structure must match what the Paddle SDK's `webhooks.unmarshal()` expects:
 * - `items[]` with a full `price` object (including `quantity` as an object)
 * - `payments[]` with `method` containing card details
 * - `details` with `tax_rates_used[]`, `totals`, `payout_totals`, `line_items[]`
 *
 * The `custom_data` field carries `userId` and `planId` which the webhook
 * route uses to determine how many credits to grant.
 */
export function mockPaddleTransactionCompletedEvent(opts: {
  userId: string;
  planId?: string;
  transactionId?: string;
  eventId?: string;
  priceId?: string;
  amount?: string;
}): string {
  const planId = opts.planId || "payg1";
  const txnId = opts.transactionId || `txn_test_${Date.now()}`;
  const evtId = opts.eventId || `evt_test_${Date.now()}`;
  const priceId = opts.priceId || "pri_test_001";
  const amount = opts.amount || "1400";
  const now = new Date().toISOString();

  return JSON.stringify({
    event_id: evtId,
    event_type: "transaction.completed",
    occurred_at: now,
    data: {
      id: txnId,
      status: "completed",
      customer_id: `ctm_test_${Date.now()}`,
      address_id: null,
      business_id: null,
      custom_data: { userId: opts.userId, planId },
      currency_code: "EUR",
      origin: "api",
      subscription_id: null,
      invoice_id: null,
      invoice_number: null,
      collection_mode: "automatic",
      discount_id: null,
      billing_details: null,
      billing_period: null,
      items: [
        {
          price_id: priceId,
          quantity: 1,
          proration: null,
          price: {
            id: priceId,
            product_id: "pro_test_001",
            description: "Verifa Report — 1 kredit",
            name: "Verifa Report — 1 kredit",
            type: "standard",
            billing_cycle: null,
            trial_period: null,
            tax_mode: "exclusive",
            unit_price: { amount, currency_code: "EUR" },
            unit_price_overrides: [],
            quantity: { minimum: 1, maximum: 1 },
            status: "active",
            created_at: now,
            updated_at: now,
            custom_data: null,
            import_meta: null,
          },
          product: {
            id: "pro_test_001",
            name: "Verifa Report — 1 kredit",
            type: "standard",
            status: "active",
          },
        },
      ],
      details: {
        tax_rates_used: [],
        totals: {
          subtotal: amount,
          discount: "0",
          tax: "0",
          total: amount,
          credit: "0",
          credit_to_balance: "0",
          balance: "0",
          grand_total: amount,
          grand_total_tax: "0",
          fee: null,
          earnings: null,
          currency_code: "EUR",
        },
        adjusted_totals: null,
        payout_totals: {
          subtotal: amount,
          discount: "0",
          tax: "0",
          total: amount,
          credit: "0",
          credit_to_balance: "0",
          balance: "0",
          grand_total: amount,
          grand_total_tax: "0",
          fee: null,
          earnings: null,
          currency_code: "EUR",
          minimum_payout_amount: null,
          payout_attempt: null,
        },
        adjusted_payout_totals: null,
        line_items: [],
      },
      payments: [
        {
          type: "payment",
          status: "captured",
          method: {
            type: "card",
            card: { type: "visa", last4: "4242", expiry_month: "12", expiry_year: "2030" },
          },
          amount,
          currency_code: "EUR",
        },
      ],
      checkout: null,
      created_at: now,
      updated_at: now,
      billed_at: now,
      revised_at: null,
    },
  });
}

/**
 * Generate a mock Paddle `adjustment.updated` webhook event body (refund/chargeback).
 * The webhook route maps this to `charge.refunded` and revokes credits.
 */
export function mockPaddleAdjustmentUpdatedEvent(opts: {
  userId?: string;
  planId?: string;
  transactionId: string;
  adjustmentId?: string;
  eventId?: string;
  action?: string;
  status?: string;
  total?: string;
}): string {
  const adjId = opts.adjustmentId || `adj_test_${Date.now()}`;
  const evtId = opts.eventId || `evt_test_${Date.now()}`;
  const action = opts.action || "refund";
  const status = opts.status || "approved";
  const total = opts.total || "1400";
  const now = new Date().toISOString();

  return JSON.stringify({
    event_id: evtId,
    event_type: "adjustment.updated",
    occurred_at: now,
    data: {
      id: adjId,
      action,
      status,
      transaction_id: opts.transactionId,
      customer_id: `ctm_test_${Date.now()}`,
      currency_code: "EUR",
      custom_data: opts.userId ? { userId: opts.userId, planId: opts.planId || "payg1" } : null,
      totals: {
        total,
        chargeback_fee: { amount: "0", currency_code: "EUR" },
        currency_code: "EUR",
      },
      created_at: now,
      updated_at: now,
    },
  });
}
