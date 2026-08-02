/**
 * Unit tests for the credit system (src/lib/credits.ts).
 *
 * These tests mock the Prisma client by setting globalThis.prisma before
 * importing credits.ts. The mock uses a shared mutable config so tests
 * can change mock data without re-importing the module.
 *
 * Coverage:
 * - consumeCreditsTx: FIFO ordering, insufficient credits, expired credits, no wallet
 * - refundCreditsTx: idempotency, LIFO refund, rollover batch, no wallet
 * - revokeCreditsOnRefund: idempotency, cascade, negative balance, TOPUP not found
 * - addCreditBatch: debt settlement, idempotency, wallet creation
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "module";
import type { PrismaClient } from "@prisma/client";

const require = createRequire(import.meta.url);

// ─── Shared mutable config ────────────────────────────────────────────────────

interface MockRow { [key: string]: unknown; }

interface MockConfig {
  walletRows: MockRow[];
  batchRows: MockRow[];
  userRows: MockRow[];
  walletFindUnique?: (args: any) => any;
  walletUpdate?: (args: any) => any;
  walletCreate?: (args: any) => any;
  batchUpdate?: (args: any) => any;
  batchCreate?: (args: any) => any;
  txFindUnique?: (args: any) => any;
  txFindFirst?: (args: any) => any;
  txCreate?: (args: any) => any;
  userFindUnique?: (args: any) => any;
  batchFindMany?: (args: any) => any;
  batchAggregate?: (args: any) => any;
  userFindMany?: (args: any) => any;
  calls: { method: string; args: any }[];
}

// Single shared config — updated before each test
const config: MockConfig = {
  walletRows: [],
  batchRows: [],
  userRows: [],
  calls: [],
};

function resetConfig() {
  config.walletRows = [];
  config.batchRows = [];
  config.userRows = [];
  config.walletFindUnique = undefined;
  config.walletUpdate = undefined;
  config.walletCreate = undefined;
  config.batchUpdate = undefined;
  config.batchCreate = undefined;
  config.txFindUnique = undefined;
  config.txFindFirst = undefined;
  config.txCreate = undefined;
  config.userFindUnique = undefined;
  config.batchFindMany = undefined;
  config.batchAggregate = undefined;
  config.userFindMany = undefined;
  config.calls = [];
}

function callsTo(method: string) {
  return config.calls.filter((c) => c.method === method);
}

// ─── Mock Prisma ──────────────────────────────────────────────────────────────

function createMockTx() {
  return {
    $queryRaw: (strings: TemplateStringsArray, ..._values: any[]) => {
      const sql = strings.join("?");
      config.calls.push({ method: "$queryRaw", args: { sql } });
      if (sql.includes('"Wallet"')) return Promise.resolve(config.walletRows);
      if (sql.includes('"CreditBatch"')) return Promise.resolve(config.batchRows);
      if (sql.includes('"User"')) return Promise.resolve(config.userRows);
      return Promise.resolve([]);
    },
    wallet: {
      update: async (args: any) => {
        config.calls.push({ method: "wallet.update", args });
        return config.walletUpdate?.(args) ?? { id: "w1", balance: 0, version: 1 };
      },
      create: async (args: any) => {
        config.calls.push({ method: "wallet.create", args });
        return config.walletCreate?.(args) ?? { id: "w1", balance: 0, version: 1 };
      },
    },
    creditBatch: {
      update: async (args: any) => {
        config.calls.push({ method: "creditBatch.update", args });
        return config.batchUpdate?.(args) ?? {};
      },
      create: async (args: any) => {
        config.calls.push({ method: "creditBatch.create", args });
        return config.batchCreate?.(args) ?? {};
      },
    },
    walletTransaction: {
      findUnique: async (args: any) => {
        config.calls.push({ method: "walletTransaction.findUnique", args });
        return config.txFindUnique?.(args) ?? null;
      },
      findFirst: async (args: any) => {
        config.calls.push({ method: "walletTransaction.findFirst", args });
        return config.txFindFirst?.(args) ?? null;
      },
      create: async (args: any) => {
        config.calls.push({ method: "walletTransaction.create", args });
        return config.txCreate?.(args) ?? {};
      },
    },
    user: {
      findUnique: async (args: any) => {
        config.calls.push({ method: "user.findUnique", args });
        return config.userFindUnique?.(args) ?? null;
      },
    },
  };
}

function createMockPrisma(): PrismaClient {
  return {
    $transaction: async (fn: (tx: any) => Promise<any>) => fn(createMockTx()),
    creditBatch: {
      findMany: async (args: any) => {
        config.calls.push({ method: "creditBatch.findMany", args });
        return config.batchFindMany?.(args) ?? [];
      },
      aggregate: async (args: any) => {
        config.calls.push({ method: "creditBatch.aggregate", args });
        return config.batchAggregate?.(args) ?? { _sum: { remaining: 0 } };
      },
    },
    user: {
      findMany: async (args: any) => {
        config.calls.push({ method: "user.findMany", args });
        return config.userFindMany?.(args) ?? [];
      },
      findUnique: async (args: any) => {
        config.calls.push({ method: "user.findUnique", args });
        return config.userFindUnique?.(args) ?? null;
      },
    },
    wallet: {
      findUnique: async (args: any) => {
        config.calls.push({ method: "wallet.findUnique", args });
        return config.walletFindUnique?.(args) ?? null;
      },
    },
  } as unknown as PrismaClient;
}

// Set mock BEFORE requiring credits.ts (require is not hoisted, unlike import)
(globalThis as any).prisma = createMockPrisma();
const credits = require("../credits");

beforeEach(() => resetConfig());

// ─── Tests: consumeCreditsTx ──────────────────────────────────────────────────

describe("consumeCreditsTx", () => {
  it("deducts from oldest batch first (FIFO)", async () => {
    config.walletRows = [{ id: "w1", userId: "u1", balance: 10, version: 1 }];
    config.batchRows = [
      { id: "b1", userId: "u1", remaining: 3, expiresAt: new Date("2026-01-01"), amount: 5 },
      { id: "b2", userId: "u1", remaining: 7, expiresAt: new Date("2026-06-01"), amount: 10 },
    ];

    const result = await credits.consumeCreditsTx(createMockTx(), "u1", 5, "report-1");

    assert.equal(result.ok, true);
    const batchUpdates = callsTo("creditBatch.update");
    assert.equal(batchUpdates.length, 2);
    assert.equal(batchUpdates[0].args.where.id, "b1");
    assert.equal(batchUpdates[0].args.data.remaining.decrement, 3);
    assert.equal(batchUpdates[1].args.where.id, "b2");
    assert.equal(batchUpdates[1].args.data.remaining.decrement, 2);

    const walletUpdate = callsTo("wallet.update")[0];
    assert.equal(walletUpdate.args.data.balance.decrement, 5);
  });

  it("returns INSUFFICIENT when wallet balance < amount", async () => {
    config.walletRows = [{ id: "w1", userId: "u1", balance: 2, version: 1 }];

    const result = await credits.consumeCreditsTx(createMockTx(), "u1", 5);

    assert.equal(result.ok, false);
    assert.equal(result.reason, "INSUFFICIENT");
    assert.equal(callsTo("creditBatch.update").length, 0);
  });

  it("returns NO_WALLET when wallet doesn't exist", async () => {
    config.walletRows = [];

    const result = await credits.consumeCreditsTx(createMockTx(), "u1", 1);

    assert.equal(result.ok, false);
    assert.equal(result.reason, "NO_WALLET");
  });

  it("returns EXPIRED when wallet has balance but all batches expired", async () => {
    config.walletRows = [{ id: "w1", userId: "u1", balance: 5, version: 1 }];
    config.batchRows = [];

    const result = await credits.consumeCreditsTx(createMockTx(), "u1", 1);

    assert.equal(result.ok, false);
    assert.equal(result.reason, "EXPIRED");
  });

  it("creates a CHARGE transaction with reportRequestId", async () => {
    config.walletRows = [{ id: "w1", userId: "u1", balance: 10, version: 1 }];
    config.batchRows = [{ id: "b1", userId: "u1", remaining: 10, expiresAt: new Date("2026-06-01"), amount: 10 }];

    await credits.consumeCreditsTx(createMockTx(), "u1", 1, "report-123");

    const txCreate = callsTo("walletTransaction.create")[0];
    assert.equal(txCreate.args.data.type, "CHARGE");
    assert.equal(txCreate.args.data.reportRequestId, "report-123");
    assert.equal(txCreate.args.data.status, "COMPLETED");
  });

  it("handles exact-amount consumption from single batch", async () => {
    config.walletRows = [{ id: "w1", userId: "u1", balance: 5, version: 1 }];
    config.batchRows = [{ id: "b1", userId: "u1", remaining: 5, expiresAt: new Date("2026-06-01"), amount: 5 }];

    const result = await credits.consumeCreditsTx(createMockTx(), "u1", 5);

    assert.equal(result.ok, true);
    assert.equal(callsTo("creditBatch.update").length, 1);
    assert.equal(callsTo("creditBatch.update")[0].args.data.remaining.decrement, 5);
  });
});

// ─── Tests: refundCreditsTx ───────────────────────────────────────────────────

describe("refundCreditsTx", () => {
  it("is idempotent — skips if REFUND transaction already exists", async () => {
    config.walletRows = [{ id: "w1", userId: "u1", balance: 5, version: 1 }];
    let call = 0;
    config.txFindFirst = () => {
      call++;
      if (call === 1) return { id: "tx-charge", type: "CHARGE", reportRequestId: "r1" };
      return { id: "tx-refund", type: "REFUND", reportRequestId: "r1" };
    };

    await credits.refundCreditsTx(createMockTx(), "u1", 1, "r1");

    assert.equal(callsTo("creditBatch.update").length, 0);
    assert.equal(callsTo("wallet.update").length, 0);
    assert.equal(callsTo("walletTransaction.create").length, 0);

    // Verify the idempotency check includes walletId (not just type + reportRequestId)
    const refundCheck = callsTo("walletTransaction.findFirst")[1];
    assert.equal(refundCheck.args.where.walletId, "w1");
  });

  it("is idempotent — skips if no CHARGE transaction exists", async () => {
    config.walletRows = [{ id: "w1", userId: "u1", balance: 5, version: 1 }];
    config.txFindFirst = () => null;

    await credits.refundCreditsTx(createMockTx(), "u1", 1, "r1");

    assert.equal(callsTo("creditBatch.update").length, 0);
    assert.equal(callsTo("wallet.update").length, 0);
  });

  it("skips silently if wallet doesn't exist", async () => {
    config.walletRows = [];

    await credits.refundCreditsTx(createMockTx(), "u1", 1, "r1");

    assert.equal(callsTo("wallet.update").length, 0);
  });

  it("creates rollover batch when no batch has space", async () => {
    config.walletRows = [{ id: "w1", userId: "u1", balance: 0, version: 1 }];
    let call = 0;
    config.txFindFirst = () => {
      call++;
      if (call === 1) return { id: "tx-charge", type: "CHARGE", reportRequestId: "r1" };
      return null;
    };
    config.batchRows = [
      { id: "b2", userId: "u1", remaining: 10, amount: 10, expiresAt: new Date("2026-06-01"), createdAt: new Date("2026-01-01") },
    ];

    await credits.refundCreditsTx(createMockTx(), "u1", 3, "r1");

    const batchCreate = callsTo("creditBatch.create")[0];
    assert.ok(batchCreate, "Should create a rollover batch");
    assert.equal(batchCreate.args.data.source, "rollover");
    assert.equal(batchCreate.args.data.remaining, 3);

    const walletUpdate = callsTo("wallet.update")[0];
    assert.equal(walletUpdate.args.data.balance.increment, 3);

    const txCreate = callsTo("walletTransaction.create")[0];
    assert.equal(txCreate.args.data.type, "REFUND");
    assert.equal(txCreate.args.data.reportRequestId, "r1");
  });

  it("refunds to batch with space (remaining < amount)", async () => {
    config.walletRows = [{ id: "w1", userId: "u1", balance: 0, version: 1 }];
    let call = 0;
    config.txFindFirst = () => {
      call++;
      if (call === 1) return { id: "tx-charge", type: "CHARGE", reportRequestId: "r1" };
      return null;
    };
    // Batch has space: remaining=3, amount=10 → space=7
    config.batchRows = [
      { id: "b1", userId: "u1", remaining: 3, amount: 10, expiresAt: new Date("2026-06-01"), createdAt: new Date("2026-01-01") },
    ];

    await credits.refundCreditsTx(createMockTx(), "u1", 5, "r1");

    // Should update the batch (add 5 to remaining), not create a rollover
    assert.equal(callsTo("creditBatch.update").length, 1);
    assert.equal(callsTo("creditBatch.update")[0].args.where.id, "b1");
    assert.equal(callsTo("creditBatch.update")[0].args.data.remaining.increment, 5);
    assert.equal(callsTo("creditBatch.create").length, 0);

    // Verify wallet update uses primary key (id), not userId
    const walletUpdate = callsTo("wallet.update")[0];
    assert.equal(walletUpdate.args.where.id, "w1");
    assert.equal(walletUpdate.args.where.userId, undefined);
  });
});

// ─── Tests: revokeCreditsOnRefund ─────────────────────────────────────────────

describe("revokeCreditsOnRefund", () => {
  it("is idempotent — skips if REFUND_DEDUCTION already exists", async () => {
    config.walletRows = [{ id: "w1", userId: "u1", balance: 10, version: 1 }];
    config.txFindUnique = () => ({ id: "existing-deduction", type: "REFUND_DEDUCTION" });

    const result = await credits.revokeCreditsOnRefund("u1", 5, "refund-1", "pi-original", "STRIPE");

    assert.equal(result.revoked, 0);
    assert.equal(callsTo("wallet.update").length, 0);
    assert.equal(callsTo("creditBatch.update").length, 0);
  });

  it("returns revoked=-1 when original TOPUP not found (out-of-order webhook)", async () => {
    config.walletRows = [{ id: "w1", userId: "u1", balance: 10, version: 1 }];
    config.txFindUnique = () => null;
    config.txFindFirst = () => null;

    const result = await credits.revokeCreditsOnRefund("u1", 5, "refund-1", "pi-missing", "STRIPE");

    assert.equal(result.revoked, -1);
    assert.equal(callsTo("wallet.update").length, 0);
  });

  it("deducts from original batch and cascades to other batches", async () => {
    config.walletRows = [{ id: "w1", userId: "u1", balance: 10, version: 1 }];
    config.txFindUnique = () => null;
    config.txFindFirst = () => ({
      id: "tx-topup", type: "TOPUP", amount: 10,
      providerReference: "pi-original", createdAt: new Date("2026-01-01"),
    });
    config.userFindUnique = () => ({ email: "user@test.sk", name: "Test" });
    config.batchRows = [
      { id: "b-orig", userId: "u1", remaining: 3, expiresAt: new Date("2026-06-01") },
      { id: "b-other", userId: "u1", remaining: 10, expiresAt: new Date("2026-12-01") },
    ];
    config.walletUpdate = () => ({ id: "w1", balance: 5, version: 2 });

    const result = await credits.revokeCreditsOnRefund("u1", 5, "refund-1", "pi-original", "STRIPE");

    assert.equal(result.revoked, 5);
    const walletUpdate = callsTo("wallet.update")[0];
    assert.equal(walletUpdate.args.data.balance.decrement, 5);
    const txCreate = callsTo("walletTransaction.create")[0];
    assert.equal(txCreate.args.data.type, "REFUND_DEDUCTION");
    assert.equal(txCreate.args.data.providerReference, "refund-1");
  });

  it("auto-detects credits from TOPUP amount when creditsToRevoke=-1", async () => {
    config.walletRows = [{ id: "w1", userId: "u1", balance: 50, version: 1 }];
    config.txFindUnique = () => null;
    config.txFindFirst = () => ({
      id: "tx-topup", type: "TOPUP", amount: 50,
      providerReference: "pi-original", createdAt: new Date("2026-01-01"),
    });
    config.userFindUnique = () => ({ email: "user@test.sk", name: null });
    config.batchRows = [{ id: "b1", userId: "u1", remaining: 50, expiresAt: new Date("2026-06-01") }];
    config.walletUpdate = () => ({ id: "w1", balance: 0, version: 2 });

    const result = await credits.revokeCreditsOnRefund("u1", -1, "refund-1", "pi-original", "STRIPE");

    assert.equal(result.revoked, 50);
    assert.equal(callsTo("wallet.update")[0].args.data.balance.decrement, 50);
  });

  it("returns revoked=0 when TOPUP amount is 0", async () => {
    config.walletRows = [{ id: "w1", userId: "u1", balance: 10, version: 1 }];
    config.txFindUnique = () => null;
    config.txFindFirst = () => ({
      id: "tx-topup", type: "TOPUP", amount: 0,
      providerReference: "pi-original", createdAt: new Date("2026-01-01"),
    });

    const result = await credits.revokeCreditsOnRefund("u1", -1, "refund-1", "pi-original", "STRIPE");

    assert.equal(result.revoked, 0);
    assert.equal(callsTo("wallet.update").length, 0);
  });

  it("returns userEmail for notifications", async () => {
    config.walletRows = [{ id: "w1", userId: "u1", balance: 10, version: 1 }];
    config.txFindUnique = () => null;
    config.txFindFirst = () => ({
      id: "tx-topup", type: "TOPUP", amount: 5,
      providerReference: "pi-original", createdAt: new Date("2026-01-01"),
    });
    config.userFindUnique = () => ({ email: "user@test.sk", name: "Test User" });
    config.batchRows = [{ id: "b1", userId: "u1", remaining: 5, expiresAt: new Date("2026-06-01") }];
    config.walletUpdate = () => ({ id: "w1", balance: 5, version: 2 });

    const result = await credits.revokeCreditsOnRefund("u1", 5, "refund-1", "pi-original", "STRIPE");

    assert.equal(result.userEmail, "user@test.sk");
  });
});

// ─── Tests: addCreditBatch ────────────────────────────────────────────────────

describe("addCreditBatch", () => {
  it("creates a credit batch and increments wallet balance", async () => {
    config.walletRows = [{ id: "w1", userId: "u1", balance: 5, version: 1 }];
    config.txFindUnique = () => null;

    await credits.addCreditBatch("u1", 10, "subscription", "freelance", "inv-123", "STRIPE");

    const batchCreate = callsTo("creditBatch.create")[0];
    assert.equal(batchCreate.args.data.userId, "u1");
    assert.equal(batchCreate.args.data.amount, 10);
    assert.equal(batchCreate.args.data.remaining, 10);
    assert.equal(batchCreate.args.data.source, "subscription");

    const walletUpdate = callsTo("wallet.update")[0];
    assert.equal(walletUpdate.args.data.balance.increment, 10);

    const txCreate = callsTo("walletTransaction.create")[0];
    assert.equal(txCreate.args.data.type, "TOPUP");
    assert.equal(txCreate.args.data.providerReference, "inv-123");
    assert.equal(txCreate.args.data.provider, "STRIPE");
  });

  it("settles negative balance (debt) by reducing new batch remaining", async () => {
    config.walletRows = [{ id: "w1", userId: "u1", balance: -3, version: 1 }];
    config.txFindUnique = () => null;

    await credits.addCreditBatch("u1", 10, "addon", "addon5", "pi-123", "STRIPE");

    // Batch remaining = 10 - 3 (debt) = 7
    const batchCreate = callsTo("creditBatch.create")[0];
    assert.equal(batchCreate.args.data.remaining, 7);

    // Wallet balance incremented by full 10: -3 + 10 = 7
    const walletUpdate = callsTo("wallet.update")[0];
    assert.equal(walletUpdate.args.data.balance.increment, 10);
  });

  it("is idempotent — skips if transaction with providerReference already exists", async () => {
    config.walletRows = [{ id: "w1", userId: "u1", balance: 5, version: 1 }];
    config.txFindUnique = () => ({ id: "existing-tx", type: "TOPUP", providerReference: "inv-123" });

    await credits.addCreditBatch("u1", 10, "subscription", "freelance", "inv-123", "STRIPE");

    assert.equal(callsTo("creditBatch.create").length, 0);
    assert.equal(callsTo("wallet.update").length, 0);
    assert.equal(callsTo("walletTransaction.create").length, 0);
  });

  it("handles debt larger than amount (full settlement, remaining=0)", async () => {
    config.walletRows = [{ id: "w1", userId: "u1", balance: -15, version: 1 }];
    config.txFindUnique = () => null;

    await credits.addCreditBatch("u1", 10, "subscription", "freelance", "inv-456", "STRIPE");

    // Debt=15, amount=10 → settledDebt=min(15,10)=10, remaining=10-10=0
    const batchCreate = callsTo("creditBatch.create")[0];
    assert.equal(batchCreate.args.data.remaining, 0);

    // Wallet: -15 + 10 = -5 (still in debt)
    const walletUpdate = callsTo("wallet.update")[0];
    assert.equal(walletUpdate.args.data.balance.increment, 10);
  });

  it("sets correct expiry based on source type", async () => {
    config.walletRows = [{ id: "w1", userId: "u1", balance: 0, version: 1 }];
    config.txFindUnique = () => null;

    await credits.addCreditBatch("u1", 1, "trial");

    const batchCreate = callsTo("creditBatch.create")[0];
    const expiresAt = batchCreate.args.data.expiresAt as Date;
    const now = new Date();
    const diffDays = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    // trial = 30 days
    assert.ok(diffDays >= 29 && diffDays <= 31, `Expected ~30 days, got ${diffDays}`);
  });
});

// ─── Credit consistency: UI vs Report API ─────────────────────────────────
// The bug: /api/credits/plan used Wallet.balance (stale if cron hasn't run),
// but /api/reports used SUM(CreditBatch.remaining WHERE expiresAt > NOW()).
// This test suite verifies the correct query pattern.

describe("Credit consistency: UI vs Report API", () => {
  // Simulate the credit check logic used by both /api/reports and /api/credits/plan
  function calculateAvailableCredits(
    batches: { remaining: number; expiresAt: Date; source: string }[]
  ): number {
    const now = new Date();
    return batches
      .filter((b) => b.remaining > 0 && b.expiresAt > now)
      .reduce((sum, b) => sum + b.remaining, 0);
  }

  function calculateRolloverCredits(
    batches: { remaining: number; expiresAt: Date; source: string }[]
  ): number {
    const now = new Date();
    return batches
      .filter((b) => b.remaining > 0 && b.expiresAt > now && b.source === "rollover")
      .reduce((sum, b) => sum + b.remaining, 0);
  }

  // Simulate stale Wallet.balance (not decremented by cron)
  function calculateWalletBalance(
    batches: { remaining: number; expiresAt: Date; source: string }[]
  ): number {
    // Wallet.balance = SUM(all batch.remaining) — includes expired if cron hasn't run
    return batches.reduce((sum, b) => sum + b.remaining, 0);
  }

  it("returns 0 when all batches are expired (CreditBatch SUM)", () => {
    const batches = [
      { remaining: 2, expiresAt: new Date(Date.now() - 86400000), source: "trial" },
    ];
    assert.equal(calculateAvailableCredits(batches), 0);
  });

  it("returns 2 when Wallet.balance is stale (bug scenario)", () => {
    const batches = [
      { remaining: 2, expiresAt: new Date(Date.now() - 86400000), source: "trial" },
    ];
    // Wallet.balance is stale — shows 2 even though credits expired
    assert.equal(calculateWalletBalance(batches), 2);
    // But CreditBatch SUM correctly shows 0
    assert.equal(calculateAvailableCredits(batches), 0);
  });

  it("returns correct count when some batches are expired", () => {
    const batches = [
      { remaining: 5, expiresAt: new Date(Date.now() + 86400000), source: "subscription" },
      { remaining: 3, expiresAt: new Date(Date.now() - 86400000), source: "trial" },
    ];
    // Only the non-expired batch counts
    assert.equal(calculateAvailableCredits(batches), 5);
    // Wallet.balance would show 8 (stale)
    assert.equal(calculateWalletBalance(batches), 8);
  });

  it("returns 0 when all batches have remaining=0", () => {
    const batches = [
      { remaining: 0, expiresAt: new Date(Date.now() + 86400000), source: "subscription" },
    ];
    assert.equal(calculateAvailableCredits(batches), 0);
  });

  it("counts rollover credits separately", () => {
    const batches = [
      { remaining: 5, expiresAt: new Date(Date.now() + 86400000), source: "subscription" },
      { remaining: 3, expiresAt: new Date(Date.now() + 86400000), source: "rollover" },
    ];
    assert.equal(calculateAvailableCredits(batches), 8);
    assert.equal(calculateRolloverCredits(batches), 3);
  });

  it("excludes expired rollover credits", () => {
    const batches = [
      { remaining: 5, expiresAt: new Date(Date.now() + 86400000), source: "subscription" },
      { remaining: 3, expiresAt: new Date(Date.now() - 86400000), source: "rollover" },
    ];
    assert.equal(calculateAvailableCredits(batches), 5);
    assert.equal(calculateRolloverCredits(batches), 0);
  });

  it("UI and Report API return the same value when cron has run", () => {
    // After cron runs, expired batches have remaining=0, so both methods agree
    const batches = [
      { remaining: 0, expiresAt: new Date(Date.now() - 86400000), source: "trial" },
      { remaining: 5, expiresAt: new Date(Date.now() + 86400000), source: "subscription" },
    ];
    assert.equal(calculateAvailableCredits(batches), 5);
    assert.equal(calculateWalletBalance(batches), 5); // Same after cron
  });

  it("UI and Report API DISAGREE when cron hasn't run (the bug)", () => {
    const batches = [
      { remaining: 2, expiresAt: new Date(Date.now() - 86400000), source: "trial" },
    ];
    // This is the exact bug scenario: UI shows 2, report API blocks
    assert.equal(calculateWalletBalance(batches), 2);
    assert.equal(calculateAvailableCredits(batches), 0);
    assert.notEqual(calculateWalletBalance(batches), calculateAvailableCredits(batches));
  });

  it("addon credits never expire (36500 days)", () => {
    const farFuture = new Date(Date.now() + 36500 * 86400000);
    const batches = [
      { remaining: 10, expiresAt: farFuture, source: "addon" },
    ];
    assert.equal(calculateAvailableCredits(batches), 10);
  });

  it("mixed sources with partial expiry", () => {
    const now = Date.now();
    const batches = [
      { remaining: 5, expiresAt: new Date(now + 86400000), source: "subscription" },
      { remaining: 3, expiresAt: new Date(now + 86400000), source: "rollover" },
      { remaining: 2, expiresAt: new Date(now - 86400000), source: "trial" },
      { remaining: 10, expiresAt: new Date(now + 36500 * 86400000), source: "addon" },
    ];
    assert.equal(calculateAvailableCredits(batches), 18); // 5 + 3 + 10
    assert.equal(calculateRolloverCredits(batches), 3);
  });
});
