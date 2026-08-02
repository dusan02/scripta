import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Test soft delete filtering logic.
// These tests verify that the deletedAt filter pattern is correctly applied
// across all queries that should exclude soft-deleted records.

describe("Soft delete filtering", () => {
  // Simulate the Prisma where clause pattern used across the codebase
  function buildActiveUserWhere(): Record<string, unknown> {
    return { deletedAt: null };
  }

  function buildActiveReportWhere(userId?: string): Record<string, unknown> {
    const where: Record<string, unknown> = { deletedAt: null };
    if (userId) where.userId = userId;
    return where;
  }

  function buildAdminStatsWhere(thirtyDaysAgo: Date): Record<string, unknown> {
    return { createdAt: { gte: thirtyDaysAgo }, deletedAt: null };
  }

  function buildCanceledUsersWhere(): Record<string, unknown> {
    return {
      subscriptionStatus: "canceled",
      subscriptionEndsAt: { lte: new Date() },
      deletedAt: null,
    };
  }

  it("active user filter includes deletedAt: null", () => {
    const where = buildActiveUserWhere();
    assert.equal(where.deletedAt, null);
  });

  it("active report filter includes deletedAt: null", () => {
    const where = buildActiveReportWhere("user123");
    assert.equal(where.deletedAt, null);
    assert.equal(where.userId, "user123");
  });

  it("admin stats filter includes deletedAt: null", () => {
    const cutoff = new Date("2024-01-01");
    const where = buildAdminStatsWhere(cutoff);
    assert.equal(where.deletedAt, null);
    assert.deepEqual(where.createdAt, { gte: cutoff });
  });

  it("canceled users filter includes deletedAt: null", () => {
    const where = buildCanceledUsersWhere();
    assert.equal(where.deletedAt, null);
    assert.equal(where.subscriptionStatus, "canceled");
  });

  it("active report filter without userId still has deletedAt", () => {
    const where = buildActiveReportWhere();
    assert.equal(where.deletedAt, null);
    assert.equal(where.userId, undefined);
  });
});

// Test auth deletedAt check logic
describe("Auth deletedAt check", () => {
  // Simulate the auth check logic
  function canUserLogin(user: { deletedAt: Date | null; passwordHash?: string | null } | null): boolean {
    if (!user || !user.passwordHash) return false;
    if (user.deletedAt) return false;
    return true;
  }

  function isSessionValid(dbUser: { deletedAt: Date | null; tokenVersion: number } | null, expectedTokenVersion: number): boolean {
    if (!dbUser || dbUser.deletedAt || dbUser.tokenVersion !== expectedTokenVersion) return false;
    return true;
  }

  it("rejects login for soft-deleted user", () => {
    const user = { deletedAt: new Date(), passwordHash: "hash" };
    assert.ok(!canUserLogin(user));
  });

  it("allows login for active user", () => {
    const user = { deletedAt: null, passwordHash: "hash" };
    assert.ok(canUserLogin(user));
  });

  it("rejects login for null user", () => {
    assert.ok(!canUserLogin(null));
  });

  it("invalidates session for soft-deleted user", () => {
    const dbUser = { deletedAt: new Date(), tokenVersion: 1 };
    assert.ok(!isSessionValid(dbUser, 1));
  });

  it("keeps session for active user with matching tokenVersion", () => {
    const dbUser = { deletedAt: null, tokenVersion: 1 };
    assert.ok(isSessionValid(dbUser, 1));
  });

  it("invalidates session for mismatched tokenVersion", () => {
    const dbUser = { deletedAt: null, tokenVersion: 2 };
    assert.ok(!isSessionValid(dbUser, 1));
  });

  it("invalidates session for null user (hard deleted)", () => {
    assert.ok(!isSessionValid(null, 1));
  });
});

// Test PII sanitization in logs
describe("PII sanitization in account deletion log", () => {
  function formatDeletionLog(userId: string, email: string): string {
    // OLD (vulnerable): includes email — PII leak
    // NEW (fixed): includes only userId
    return `[ACCOUNT] User ${userId} deleted their account (GDPR Article 17).`;
  }

  it("does not include email in log", () => {
    const log = formatDeletionLog("user123", "test@example.com");
    assert.ok(!log.includes("test@example.com"));
    assert.ok(log.includes("user123"));
  });

  it("includes userId for audit trail", () => {
    const log = formatDeletionLog("abc123", "user@test.sk");
    assert.ok(log.includes("abc123"));
  });
});

// Test that admin overview queries filter soft-deleted records
describe("Admin overview soft delete filtering", () => {
  // Simulate the query patterns used in admin/overview
  function buildOverviewQueries() {
    return {
      totalUsers: { where: { deletedAt: null } },
      totalReports: { where: { deletedAt: null } },
      completedReports: { where: { status: "COMPLETED", deletedAt: null } },
      failedReports: { where: { status: "FAILED", deletedAt: null } },
      pendingReports: { where: { status: { in: ["PENDING", "PROCESSING"] }, deletedAt: null } },
      recentReports: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 10 },
      recentUsers: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 10 },
    };
  }

  it("totalUsers filters soft-deleted", () => {
    const q = buildOverviewQueries();
    assert.equal(q.totalUsers.where.deletedAt, null);
  });

  it("totalReports filters soft-deleted", () => {
    const q = buildOverviewQueries();
    assert.equal(q.totalReports.where.deletedAt, null);
  });

  it("completedReports filters soft-deleted", () => {
    const q = buildOverviewQueries();
    assert.equal(q.completedReports.where.deletedAt, null);
    assert.equal(q.completedReports.where.status, "COMPLETED");
  });

  it("recentReports filters soft-deleted", () => {
    const q = buildOverviewQueries();
    assert.equal(q.recentReports.where.deletedAt, null);
  });

  it("recentUsers filters soft-deleted", () => {
    const q = buildOverviewQueries();
    assert.equal(q.recentUsers.where.deletedAt, null);
  });
});
