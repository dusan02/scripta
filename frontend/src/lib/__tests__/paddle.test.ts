/**
 * Unit tests for the Paddle billing adapter (src/lib/billing/paddle.ts).
 *
 * Tests cover:
 * - PLAN_CREDITS_MAP: correct credit mapping
 * - handleWebhook: transaction.completed → payment.succeeded
 * - handleWebhook: adjustment.updated (approved refund) → charge.refunded
 * - handleWebhook: adjustment.updated (pending) → no result
 * - handleWebhook: unknown event → no result
 * - handleWebhook: missing custom_data → no result
 * - handleWebhook: unknown planId → no result (server-side credits lookup)
 * - createCheckoutSession: valid plan → returns client-side checkout URL
 * - createCheckoutSession: invalid plan → throws
 * - createCheckoutSession: missing priceId → throws
 * - Idempotency: eventId is passed through to WebhookResult
 *
 * These tests mock the Paddle SDK by intercepting the unmarshal call.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

// ─── Mock Paddle SDK ──────────────────────────────────────────────────────────

interface MockEvent {
  eventType: string;
  data: any;
  eventId?: string;
}

let mockEvent: MockEvent | null = null;
let mockTransactionResult: any = null;
let mockUnmarshalShouldThrow = false;
let mockFetchResponse: any = null;
let mockFetchShouldThrow = false;

// ─── Mock global fetch for API fallback tests ────────────────────────────────
const originalFetch = globalThis.fetch;
(globalThis as any).fetch = async (url: string, _opts?: any) => {
  if (mockFetchShouldThrow) throw new Error("Network error");
  if (mockFetchResponse) {
    return {
      ok: mockFetchResponse.ok ?? true,
      status: mockFetchResponse.status ?? 200,
      json: async () => mockFetchResponse.body,
      text: async () => JSON.stringify(mockFetchResponse.body),
    };
  }
  // Default: return a generic OK for non-API calls
  return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
};

// We mock the SDK by intercepting the module
const originalModule = require("@paddle/paddle-node-sdk");

// Create a mock Paddle class
class MockPaddle {
  webhooks = {
    unmarshal: async (_body: string, _secret: string, _signature: string) => {
      if (mockUnmarshalShouldThrow) {
        throw new Error("Invalid signature");
      }
      if (!mockEvent) return null;
      return {
        eventType: mockEvent.eventType,
        data: mockEvent.data,
        eventId: mockEvent.eventId,
      };
    },
  };
  transactions = {
    create: async (_params: any) => {
      if (!mockTransactionResult) throw new Error("Mock not configured");
      return mockTransactionResult;
    },
  };
}

// Override the Paddle constructor in the module
(originalModule as any).Paddle = MockPaddle;

// ─── Set env vars before require so PADDLE_PRICE_MAP picks them up ────────────

process.env.PADDLE_PRICE_1 = "pri_test1";
process.env.PADDLE_PRICE_10 = "pri_test10";
process.env.PADDLE_PRICE_50 = "pri_test50";

// ─── Require after mock + env setup ──────────────────────────────────────────

const { PaddleAdapter, PLAN_CREDITS_MAP, PADDLE_PRICE_MAP } = require("../billing/paddle");

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("PaddleAdapter", () => {
  let adapter: InstanceType<typeof PaddleAdapter>;

  beforeEach(() => {
    adapter = new PaddleAdapter();
    mockEvent = null;
    mockTransactionResult = null;
    mockUnmarshalShouldThrow = false;
    mockFetchResponse = null;
    mockFetchShouldThrow = false;
  });

  // ── PLAN_CREDITS_MAP ──────────────────────────────────────────────────────

  describe("PLAN_CREDITS_MAP", () => {
    it("maps payg1 to 1 credit", () => {
      assert.equal(PLAN_CREDITS_MAP["payg1"], 1);
    });

    it("maps payg10 to 10 credits", () => {
      assert.equal(PLAN_CREDITS_MAP["payg10"], 10);
    });

    it("maps payg50 to 50 credits", () => {
      assert.equal(PLAN_CREDITS_MAP["payg50"], 50);
    });

    it("returns undefined for unknown plan", () => {
      assert.equal(PLAN_CREDITS_MAP["unknown"], undefined);
    });
  });

  // ── handleWebhook: transaction.completed ──────────────────────────────────

  describe("handleWebhook: transaction.completed", () => {
    it("emits payment.succeeded with correct credits from server-side map", async () => {
      mockEvent = {
        eventType: "transaction.completed",
        eventId: "evt_01test",
        data: {
          id: "txn_01test",
          status: "completed",
          customData: { userId: "user-123", planId: "payg10" },
          items: [{ price_id: "pri_test10", quantity: 1 }],
        },
      };

      const results = await adapter.handleWebhook("body", "ts=123;h1=abc");

      assert.equal(results.length, 1);
      assert.equal(results[0].type, "payment.succeeded");
      assert.equal(results[0].userId, "user-123");
      assert.equal(results[0].credits, 10);
      assert.equal(results[0].planName, "payg10");
      assert.equal(results[0].providerReference, "txn_01test");
      assert.equal(results[0].eventId, "evt_01test");
    });

    it("returns empty for missing userId in custom_data", async () => {
      mockEvent = {
        eventType: "transaction.completed",
        eventId: "evt_01test",
        data: {
          id: "txn_01test",
          status: "completed",
          items: [{ price_id: "pri_test10", quantity: 1 }],
          customData: { planId: "payg10" },
        },
      };

      const results = await adapter.handleWebhook("body", "ts=123;h1=abc");
      assert.equal(results.length, 0);
    });

    it("returns empty when transaction has no items/price_id (fail closed)", async () => {
      mockEvent = {
        eventType: "transaction.completed",
        eventId: "evt_01test",
        data: {
          id: "txn_01test",
          status: "completed",
          customData: { userId: "user-123", planId: "payg10" },
          // No items — price_id cannot be verified → reject.
          // custom_data.planId alone must never grant credits.
        },
      };

      const results = await adapter.handleWebhook("body", "ts=123;h1=abc");
      assert.equal(results.length, 0);
    });

    it("returns empty for unknown price_id (not in server-side PADDLE_PRICE_MAP)", async () => {
      mockEvent = {
        eventType: "transaction.completed",
        eventId: "evt_01test",
        data: {
          id: "txn_01test",
          status: "completed",
          customData: { userId: "user-123", planId: "payg10" },
          items: [{ price_id: "pri_evil_unknown", quantity: 1 }],
        },
      };

      const results = await adapter.handleWebhook("body", "ts=123;h1=abc");
      assert.equal(results.length, 0);
    });

    it("does NOT use credits from custom_data — always from server-side map", async () => {
      mockEvent = {
        eventType: "transaction.completed",
        eventId: "evt_01test",
        data: {
          id: "txn_01test",
          status: "completed",
          customData: { userId: "user-123", planId: "payg1", credits: "999" },
          items: [{ price_id: "pri_test1", quantity: 1 }],
        },
      };

      const results = await adapter.handleWebhook("body", "ts=123;h1=abc");
      assert.equal(results.length, 1);
      assert.equal(results[0].credits, 1);
    });

    it("handles snake_case custom_data field name", async () => {
      mockEvent = {
        eventType: "transaction.completed",
        eventId: "evt_01test",
        data: {
          id: "txn_01test",
          status: "completed",
          custom_data: { userId: "user-123", planId: "payg1" },
          items: [{ price_id: "pri_test1", quantity: 1 }],
        },
      };

      const results = await adapter.handleWebhook("body", "ts=123;h1=abc");
      assert.equal(results.length, 1);
      assert.equal(results[0].credits, 1);
    });
  });

  // ── handleWebhook: transaction.completed — price_id is AUTHORITATIVE ───────
  // Security regression tests: custom_data.planId (client-controllable via
  // Paddle.js) must NEVER be able to inflate granted credits.

  describe("handleWebhook: price_id is authoritative over custom_data.planId", () => {
    it("SECURITY: payg1 price_id + tampered custom_data.planId=payg50 → still only 1 credit", async () => {
      mockEvent = {
        eventType: "transaction.completed",
        eventId: "evt_tamper_01",
        data: {
          id: "txn_tamper_01",
          status: "completed",
          // Attacker paid for payg1 but tampered custom_data to claim payg50
          customData: { userId: "user-123", planId: "payg50" },
          items: [{ price_id: "pri_test1", quantity: 1 }],
        },
      };

      const results = await adapter.handleWebhook("body", "ts=123;h1=abc");

      assert.equal(results.length, 1);
      assert.equal(results[0].credits, 1, "credits must come from price_id (payg1), NOT custom_data.planId (payg50)");
      assert.equal(results[0].planName, "payg1");
    });

    it("SECURITY: payg50 price_id + custom_data.planId=payg1 → 50 credits (price_id wins)", async () => {
      mockEvent = {
        eventType: "transaction.completed",
        eventId: "evt_tamper_02",
        data: {
          id: "txn_tamper_02",
          status: "completed",
          customData: { userId: "user-123", planId: "payg1" },
          items: [{ price_id: "pri_test50", quantity: 1 }],
        },
      };

      const results = await adapter.handleWebhook("body", "ts=123;h1=abc");

      assert.equal(results.length, 1);
      assert.equal(results[0].credits, 50, "credits must come from price_id (payg50)");
      assert.equal(results[0].planName, "payg50");
    });

    it("SECURITY: unknown price_id + valid-looking custom_data.planId → rejected", async () => {
      mockEvent = {
        eventType: "transaction.completed",
        eventId: "evt_tamper_03",
        data: {
          id: "txn_tamper_03",
          status: "completed",
          customData: { userId: "user-123", planId: "payg50" },
          items: [{ price_id: "pri_not_mapped_anywhere", quantity: 1 }],
        },
      };

      const results = await adapter.handleWebhook("body", "ts=123;h1=abc");
      assert.equal(results.length, 0, "unknown price_id must never grant credits");
    });

    it("supports SDK camelCase priceId field in items", async () => {
      mockEvent = {
        eventType: "transaction.completed",
        eventId: "evt_tamper_04",
        data: {
          id: "txn_tamper_04",
          status: "completed",
          customData: { userId: "user-123", planId: "payg50" },
          items: [{ priceId: "pri_test1", quantity: 1 }],
        },
      };

      const results = await adapter.handleWebhook("body", "ts=123;h1=abc");
      assert.equal(results.length, 1);
      assert.equal(results[0].credits, 1);
    });

    it("passes eventId through so the credit layer can dedupe (idempotency)", async () => {
      mockEvent = {
        eventType: "transaction.completed",
        eventId: "evt_dedupe_01",
        data: {
          id: "txn_dedupe_01",
          status: "completed",
          customData: { userId: "user-123", planId: "payg1" },
          items: [{ price_id: "pri_test1", quantity: 1 }],
        },
      };

      const results = await adapter.handleWebhook("body", "ts=123;h1=abc");
      assert.equal(results[0].eventId, "evt_dedupe_01");
    });
  });

  // ── handleWebhook: adjustment.updated ─────────────────────────────────────

  describe("handleWebhook: adjustment.updated", () => {
    it("emits charge.refunded for approved refund", async () => {
      mockEvent = {
        eventType: "adjustment.updated",
        eventId: "evt_adj_01",
        data: {
          id: "adj_01test",
          action: "refund",
          status: "approved",
          transactionId: "txn_01test",
          customData: { userId: "user-123", planId: "payg10" },
          totals: { total: "89.00" },
        },
      };

      const results = await adapter.handleWebhook("body", "ts=123;h1=abc");

      assert.equal(results.length, 1);
      assert.equal(results[0].type, "charge.refunded");
      assert.equal(results[0].userId, "user-123");
      assert.equal(results[0].providerReference, "adj_01test");
      assert.equal(results[0].originalProviderReference, "txn_01test");
      assert.equal(results[0].eventId, "evt_adj_01");
    });

    it("emits charge.refunded for approved chargeback", async () => {
      mockEvent = {
        eventType: "adjustment.updated",
        eventId: "evt_cb_01",
        data: {
          id: "adj_cb_01",
          action: "chargeback",
          status: "approved",
          transactionId: "txn_01test",
          customData: { userId: "user-123", planId: "payg1" },
          totals: { total: "14.00" },
        },
      };

      const results = await adapter.handleWebhook("body", "ts=123;h1=abc");

      assert.equal(results.length, 1);
      assert.equal(results[0].type, "charge.refunded");
      assert.equal(results[0].credits, 1);
    });

    it("returns empty for pending_approval refund", async () => {
      mockEvent = {
        eventType: "adjustment.updated",
        eventId: "evt_adj_01",
        data: {
          id: "adj_01test",
          action: "refund",
          status: "pending_approval",
          transactionId: "txn_01test",
          customData: { userId: "user-123", planId: "payg10" },
        },
      };

      const results = await adapter.handleWebhook("body", "ts=123;h1=abc");
      assert.equal(results.length, 0);
    });

    it("returns empty for rejected refund", async () => {
      mockEvent = {
        eventType: "adjustment.updated",
        eventId: "evt_adj_01",
        data: {
          id: "adj_01test",
          action: "refund",
          status: "rejected",
          transactionId: "txn_01test",
          customData: { userId: "user-123", planId: "payg10" },
        },
      };

      const results = await adapter.handleWebhook("body", "ts=123;h1=abc");
      assert.equal(results.length, 0);
    });

    it("returns empty for credit action (not refund/chargeback)", async () => {
      mockEvent = {
        eventType: "adjustment.updated",
        eventId: "evt_adj_01",
        data: {
          id: "adj_01test",
          action: "credit",
          status: "approved",
          transactionId: "txn_01test",
          customData: { userId: "user-123", planId: "payg10" },
        },
      };

      const results = await adapter.handleWebhook("body", "ts=123;h1=abc");
      assert.equal(results.length, 0);
    });
  });

  // ── handleWebhook: adjustment.updated — API fetch fallback ────────────────

  describe("handleWebhook: adjustment.updated API fetch fallback", () => {
    it("fetches transaction from Paddle API when customData is missing", async () => {
      mockEvent = {
        eventType: "adjustment.updated",
        eventId: "evt_adj_api_01",
        data: {
          id: "adj_api_01",
          action: "refund",
          status: "approved",
          transactionId: "txn_api_01",
          totals: { total: "89.00" },
        },
      };

      mockFetchResponse = {
        ok: true,
        body: {
          data: {
            id: "txn_api_01",
            status: "completed",
            custom_data: { userId: "user-from-api", planId: "payg10" },
            items: [{ price_id: "pri_test10", quantity: 1 }],
          },
        },
      };

      const results = await adapter.handleWebhook("body", "ts=123;h1=abc");

      assert.equal(results.length, 1);
      assert.equal(results[0].type, "charge.refunded");
      assert.equal(results[0].userId, "user-from-api");
      assert.equal(results[0].planName, "payg10");
      assert.equal(results[0].providerReference, "adj_api_01");
      assert.equal(results[0].originalProviderReference, "txn_api_01");
    });

    it("SECURITY: refund path derives plan from price_id, not custom_data.planId", async () => {
      mockEvent = {
        eventType: "adjustment.updated",
        eventId: "evt_adj_api_sec",
        data: {
          id: "adj_api_sec",
          action: "refund",
          status: "approved",
          transactionId: "txn_api_sec",
          totals: { total: "14.00" },
        },
      };

      // Transaction was paid as payg1 (price_id), but custom_data claims payg50.
      // Revocation amounts must follow the authoritative price_id → payg1 → 1 credit.
      mockFetchResponse = {
        ok: true,
        body: {
          data: {
            id: "txn_api_sec",
            custom_data: { userId: "user-refund-sec", planId: "payg50" },
            items: [{ price_id: "pri_test1", quantity: 1 }],
          },
        },
      };

      const results = await adapter.handleWebhook("body", "ts=123;h1=abc");

      assert.equal(results.length, 1);
      assert.equal(results[0].type, "charge.refunded");
      assert.equal(results[0].planName, "payg1", "plan must come from price_id, not custom_data.planId");
    });

    it("returns empty when API fetch fails and no customData", async () => {
      mockEvent = {
        eventType: "adjustment.updated",
        eventId: "evt_adj_api_02",
        data: {
          id: "adj_api_02",
          action: "refund",
          status: "approved",
          transactionId: "txn_api_02",
          totals: { total: "89.00" },
        },
      };

      mockFetchResponse = { ok: false, status: 404, body: { error: "Not found" } };

      const results = await adapter.handleWebhook("body", "ts=123;h1=abc");
      assert.equal(results.length, 0);
    });

    it("returns empty when fetch throws network error", async () => {
      mockEvent = {
        eventType: "adjustment.updated",
        eventId: "evt_adj_api_03",
        data: {
          id: "adj_api_03",
          action: "refund",
          status: "approved",
          transactionId: "txn_api_03",
          totals: { total: "89.00" },
        },
      };

      mockFetchShouldThrow = true;

      const results = await adapter.handleWebhook("body", "ts=123;h1=abc");
      assert.equal(results.length, 0);
    });

    it("uses customData from adjustment when present (no API fetch needed)", async () => {
      mockEvent = {
        eventType: "adjustment.updated",
        eventId: "evt_adj_api_04",
        data: {
          id: "adj_api_04",
          action: "refund",
          status: "approved",
          transactionId: "txn_api_04",
          customData: { userId: "user-direct", planId: "payg1" },
          totals: { total: "14.00" },
        },
      };

      mockFetchShouldThrow = true;

      const results = await adapter.handleWebhook("body", "ts=123;h1=abc");
      assert.equal(results.length, 1);
      assert.equal(results[0].userId, "user-direct");
      assert.equal(results[0].planName, "payg1");
    });

    it("handles chargeback via API fetch fallback", async () => {
      mockEvent = {
        eventType: "adjustment.updated",
        eventId: "evt_adj_api_05",
        data: {
          id: "adj_api_05",
          action: "chargeback",
          status: "approved",
          transactionId: "txn_api_05",
          totals: { total: "14.00", chargebackFee: { amount: "14.00" } },
        },
      };

      mockFetchResponse = {
        ok: true,
        body: {
          data: {
            id: "txn_api_05",
            custom_data: { userId: "user-chargeback", planId: "payg1" },
          },
        },
      };

      const results = await adapter.handleWebhook("body", "ts=123;h1=abc");
      assert.equal(results.length, 1);
      assert.equal(results[0].type, "charge.refunded");
      assert.equal(results[0].userId, "user-chargeback");
      assert.equal(results[0].credits, 1);
    });
  });

  // ── handleWebhook: unknown events ─────────────────────────────────────────

  describe("handleWebhook: unknown events", () => {
    it("returns empty for transaction.paid", async () => {
      mockEvent = {
        eventType: "transaction.paid",
        eventId: "evt_01",
        data: { id: "txn_01", status: "paid" },
      };

      const results = await adapter.handleWebhook("body", "ts=123;h1=abc");
      assert.equal(results.length, 0);
    });

    it("returns empty for transaction.created", async () => {
      mockEvent = {
        eventType: "transaction.created",
        eventId: "evt_01",
        data: { id: "txn_01" },
      };

      const results = await adapter.handleWebhook("body", "ts=123;h1=abc");
      assert.equal(results.length, 0);
    });

    it("returns empty for customer.created", async () => {
      mockEvent = {
        eventType: "customer.created",
        eventId: "evt_01",
        data: { id: "ctm_01" },
      };

      const results = await adapter.handleWebhook("body", "ts=123;h1=abc");
      assert.equal(results.length, 0);
    });
  });

  // ── handleWebhook: signature errors ───────────────────────────────────────

  describe("handleWebhook: signature errors", () => {
    it("throws on invalid signature", async () => {
      mockUnmarshalShouldThrow = true;

      await assert.rejects(
        () => adapter.handleWebhook("body", "bad-signature"),
        /Invalid signature/,
      );
    });
  });

  // ── createCheckoutSession ─────────────────────────────────────────────────

  describe("createCheckoutSession", () => {
    it("returns checkout URL for valid plan", async () => {
      const result = await adapter.createCheckoutSession({
        planId: "payg1",
        userId: "user-123",
        userEmail: "test@verifa.sk",
      });

      // userId is no longer in the URL — it's stored in an httpOnly cookie.
      // Only planId (public info) is in the URL.
      assert.match(result.url, /^\/credits\/checkout\?/);
      assert.match(result.url, /planId=payg1/);
      assert.doesNotMatch(result.url, /userId=user-123/);
      assert.doesNotMatch(result.url, /priceId=/);
    });

    it("throws for invalid plan ID", async () => {
      await assert.rejects(
        () => adapter.createCheckoutSession({
          planId: "invalid",
          userId: "user-123",
          userEmail: "test@verifa.sk",
        }),
        /Invalid plan/,
      );
    });

    it("throws for valid plan but missing priceId", async () => {
      const original = PADDLE_PRICE_MAP.payg1.priceId;
      PADDLE_PRICE_MAP.payg1.priceId = "";

      await assert.rejects(
        () => adapter.createCheckoutSession({
          planId: "payg1",
          userId: "user-123",
          userEmail: "test@verifa.sk",
        }),
        /Invalid plan/,
      );

      PADDLE_PRICE_MAP.payg1.priceId = original;
    });
  });

  // ── createPortalSession ───────────────────────────────────────────────────

  describe("createPortalSession", () => {
    it("throws not implemented", async () => {
      await assert.rejects(
        () => adapter.createPortalSession("test@verifa.sk"),
        /not yet implemented/,
      );
    });
  });
});
