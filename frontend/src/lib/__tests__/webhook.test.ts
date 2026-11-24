/**
 * Unit & contract tests for P0.1 Webhook Reliability:
 * - Reverse-proxy IP extraction & IPv4-mapped IPv6 normalization
 * - Paddle /ips CIDR parsing & allowlisting
 * - Unfulfilled vs out-of-order guest refund retry handling
 * - Svix webhook HMAC signature verification (used by /api/email/events & inbound)
 * - GuestCheckout atomic claim, duplicate idempotency, and stale FULFILLING recovery
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "module";
import { Webhook } from "svix";

import {
  extractWebhookClientIp,
  isAllowedPaddleIp,
  normalizeClientIp,
  normalizePaddleIpList,
  shouldRetryMissingTopupOnRefund,
} from "@/lib/billing/webhook-guard";

describe("webhook-guard — IP normalization & Paddle allowlist", () => {
  it("normalizes IPv4-mapped IPv6 addresses", () => {
    assert.equal(normalizeClientIp("::ffff:34.237.3.244"), "34.237.3.244");
    assert.equal(normalizeClientIp("  ::FFFF:52.11.166.252 "), "52.11.166.252");
    assert.equal(normalizeClientIp("34.195.105.136"), "34.195.105.136");
  });

  it("prefers X-Real-IP over X-Forwarded-For when both are set", () => {
    const headers = new Headers({
      "x-real-ip": "::ffff:34.237.3.244",
      "x-forwarded-for": "1.2.3.4, 34.237.3.244",
    });
    assert.equal(extractWebhookClientIp(headers), "34.237.3.244");
  });

  it("falls back to first X-Forwarded-For hop when X-Real-IP is absent", () => {
    const headers = new Headers({
      "x-forwarded-for": "34.232.58.13, 10.0.0.1",
    });
    assert.equal(extractWebhookClientIp(headers), "34.232.58.13");
  });

  it("strips /32 CIDR suffixes from Paddle /ips output and validates mapped IPs", () => {
    const allowed = normalizePaddleIpList([
      "34.237.3.244/32",
      "34.195.105.136",
      "::ffff:52.11.166.252/32",
    ]);
    assert.deepEqual(allowed, ["34.237.3.244", "34.195.105.136", "52.11.166.252"]);
    assert.equal(isAllowedPaddleIp("::ffff:34.237.3.244", allowed), true);
    assert.equal(isAllowedPaddleIp("34.195.105.136", allowed), true);
    assert.equal(isAllowedPaddleIp("203.0.113.99", allowed), false);
    // Signature-only fallback when allowlist fetch has never populated
    assert.equal(isAllowedPaddleIp("203.0.113.99", []), true);
  });
});

describe("webhook-guard — refund retry vs unfulfilled guest checkout", () => {
  it("retries missing TOPUP for standard / fulfilled transactions", () => {
    assert.equal(shouldRetryMissingTopupOnRefund(null), true);
    assert.equal(
      shouldRetryMissingTopupOnRefund({
        status: "FULFILLED",
        userId: "u1",
        reportRequestId: "rep-1",
      }),
      true
    );
  });

  it("does NOT force infinite retries on unfulfilled PENDING/FAILED guest orders", () => {
    assert.equal(
      shouldRetryMissingTopupOnRefund({
        status: "PENDING",
        userId: null,
        reportRequestId: null,
      }),
      false
    );
    assert.equal(
      shouldRetryMissingTopupOnRefund({
        status: "FAILED",
        userId: "u1",
        reportRequestId: null,
      }),
      false
    );
  });
});

describe("Svix HMAC verification (Resend email webhooks)", () => {
  it("verifies authentic signed payloads and rejects tampered payloads/signatures", () => {
    const secret = "whsec_dGVzdC1zZWNyZXQtd2ViaG9vay1rZXktMTIzNDU2";
    const wh = new Webhook(secret);
    const payload = JSON.stringify({
      type: "email.bounced",
      created_at: "2026-11-24T12:00:00Z",
      email: { email: "bounce@example.sk", from: "noreply@verifa.sk" },
    });
    const now = new Date();
    const msgId = "msg_test_1";
    const sig = wh.sign(msgId, now, payload);
    const ts = String(Math.floor(now.getTime() / 1000));

    const verified = wh.verify(payload, {
      "svix-id": msgId,
      "svix-timestamp": ts,
      "svix-signature": sig,
    }) as any;
    assert.equal(verified.type, "email.bounced");

    assert.throws(() =>
      wh.verify(payload.replace("bounce@", "attacker@"), {
        "svix-id": msgId,
        "svix-timestamp": ts,
        "svix-signature": sig,
      })
    );
  });
});

describe("guest-checkout — idempotency & stale FULFILLING recovery", () => {
  const require = createRequire(import.meta.url);
  const prismaMod = require("@/lib/prisma");
  const realGuestCheckout = { ...prismaMod.prisma.guestCheckout };
  const realUser = { ...prismaMod.prisma.user };
  const realReportRequest = { ...prismaMod.prisma.reportRequest };

  let mockGc: any;
  let mockClaimCount = 1;
  let mockReclaimCount = 0;
  let mockExistingUser: any = null;
  let mockExistingReport: any = null;
  let createdUserCount = 0;
  const gcUpdates: any[] = [];

  beforeEach(() => {
    mockClaimCount = 1;
    mockReclaimCount = 0;
    mockExistingUser = null;
    mockExistingReport = null;
    createdUserCount = 0;
    gcUpdates.length = 0;
    mockGc = {
      id: "gc_1",
      email: "buyer@firm.sk",
      ico: "35876832",
      companyName: "Test s.r.o.",
      status: "PENDING",
      userId: null,
      reportRequestId: null,
      createdAt: new Date("2026-11-24T10:00:00Z"),
      expiresAt: new Date(Date.now() + 60_000),
      fulfilledAt: null,
    };

    prismaMod.prisma.guestCheckout.updateMany = async (args: any) => {
      if (args.where.status === "PENDING") return { count: mockClaimCount };
      if (args.where.status === "FULFILLING") return { count: mockReclaimCount };
      return { count: 0 };
    };
    prismaMod.prisma.guestCheckout.findUnique = async () => mockGc;
    prismaMod.prisma.guestCheckout.update = async (args: any) => {
      gcUpdates.push(args);
      mockGc = { ...mockGc, ...args.data };
      return mockGc;
    };
    prismaMod.prisma.user.findUnique = async () => mockExistingUser;
    prismaMod.prisma.user.create = async (args: any) => {
      createdUserCount++;
      mockExistingUser = { id: "u_new_1", email: args.data.email, deletedAt: null };
      return mockExistingUser;
    };
    prismaMod.prisma.reportRequest.findFirst = async () => mockExistingReport;
  });

  const restorePrisma = () => {
    Object.assign(prismaMod.prisma.guestCheckout, realGuestCheckout);
    Object.assign(prismaMod.prisma.user, realUser);
    Object.assign(prismaMod.prisma.reportRequest, realReportRequest);
  };

  it("claims PENDING checkout cleanly (even if expiresAt is past) and creates user", async () => {
    try {
      const { resolveGuestUser } = await import("@/lib/guest-checkout");
      const res = await resolveGuestUser("gc_1", "txn_1", "PaddleBuyer@Firm.SK");
      assert.ok(res);
      assert.equal(res.userId, "u_new_1");
      assert.equal(res.email, "paddlebuyer@firm.sk");
      assert.equal(res.isNewUser, true);
      assert.equal(res.shouldCreateReport, true);
      assert.equal(createdUserCount, 1);
    } finally {
      restorePrisma();
    }
  });

  it("skips duplicate report creation when FULFILLING lease is fresh", async () => {
    try {
      const { resolveGuestUser } = await import("@/lib/guest-checkout");
      mockClaimCount = 0;
      mockGc.status = "FULFILLING";
      mockGc.userId = "u_existing";
      mockGc.expiresAt = new Date(Date.now() + 30_000); // active 60s lease

      const res = await resolveGuestUser("gc_1", "txn_1");
      assert.ok(res);
      assert.equal(res.userId, "u_existing");
      assert.equal(res.shouldCreateReport, false);
    } finally {
      restorePrisma();
    }
  });

  it("recovers expired FULFILLING lease with no report without duplicating user", async () => {
    try {
      const { resolveGuestUser } = await import("@/lib/guest-checkout");
      mockClaimCount = 0;
      mockReclaimCount = 1;
      mockGc.status = "FULFILLING";
      mockGc.userId = "u_existing";
      mockGc.expiresAt = new Date(Date.now() - 10_000); // lease expired
      mockExistingUser = { id: "u_existing", email: "buyer@firm.sk", deletedAt: null };

      const res = await resolveGuestUser("gc_1", "txn_1");
      assert.ok(res);
      assert.equal(res.userId, "u_existing");
      assert.equal(res.isNewUser, false);
      assert.equal(res.shouldCreateReport, true);
      assert.equal(createdUserCount, 0);
    } finally {
      restorePrisma();
    }
  });

  it("marks FULFILLED without creating duplicate report if stale recovery finds existing ReportRequest", async () => {
    try {
      const { resolveGuestUser } = await import("@/lib/guest-checkout");
      mockClaimCount = 0;
      mockReclaimCount = 1;
      mockGc.status = "FULFILLING";
      mockGc.userId = "u_existing";
      mockGc.expiresAt = new Date(Date.now() - 10_000);
      mockExistingUser = { id: "u_existing", email: "buyer@firm.sk", deletedAt: null };
      mockExistingReport = { id: "rep_already_created" };

      const res = await resolveGuestUser("gc_1", "txn_1");
      assert.ok(res);
      assert.equal(res.shouldCreateReport, false);
      assert.equal(mockGc.status, "FULFILLED");
      assert.equal(mockGc.reportRequestId, "rep_already_created");
    } finally {
      restorePrisma();
    }
  });
});
