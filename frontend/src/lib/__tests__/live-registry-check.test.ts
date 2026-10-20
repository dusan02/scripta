import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildLiveCheckSummary,
  LIVE_CHECK_REGISTRIES,
  LIVE_CHECK_RUNNING_TIMEOUT_MS,
} from "../liveRegistryCheck";

const ICO = "12345678";

function makeEvent(
  source: string,
  overrides: {
    severity?: string;
    state?: string;
    description?: string;
    amount?: number | null;
    createdAt?: Date;
    title?: string;
  } = {}
) {
  const createdAt = overrides.createdAt ?? new Date();
  return {
    source,
    eventType: "LIVE_REGISTRY_CHECK",
    severity: overrides.severity ?? "INFO",
    title: overrides.title ?? source,
    description: overrides.description ?? "desc",
    amount: overrides.amount ?? null,
    metadata: {
      state: overrides.state ?? "CLEAN",
      checkedAt: createdAt.toISOString(),
      statusMessage: "",
    },
    createdAt,
  };
}

describe("buildLiveCheckSummary", () => {
  it("returns all IDLE items with no events", () => {
    const s = buildLiveCheckSummary(ICO, []);
    assert.equal(s.hasCheck, false);
    assert.equal(s.isRunning, false);
    assert.equal(s.items.length, LIVE_CHECK_REGISTRIES.length);
    assert.ok(s.items.every((i) => i.state === "IDLE"));
  });

  it("maps AMBIGUOUS meta state to item state and unavailableCount (not DEBT)", () => {
    const events = [
      makeEvent("FS_DANOVE_DLZNICI", {
        state: "AMBIGUOUS",
        severity: "MEDIUM",
        description: "Podobný názov — vyžaduje manuálne overenie",
      }),
    ];
    const s = buildLiveCheckSummary(ICO, events);
    const item = s.items.find((i) => i.source === "FS_DANOVE_DLZNICI")!;
    assert.equal(item.state, "AMBIGUOUS");
    assert.equal(s.debtCount, 0);
    assert.equal(s.cleanCount, 0);
    assert.equal(s.unavailableCount, 1);
    assert.equal(s.totalDebtEur, 0);
  });

  it("RUNNING within timeout window stays RUNNING (regression: 120s was too short)", () => {
    // 200s old — was previously flipped to UNAVAILABLE by the 120s timeout
    const events = [
      makeEvent("SP_DLZNICI", {
        state: "RUNNING",
        createdAt: new Date(Date.now() - 200 * 1000),
      }),
    ];
    const s = buildLiveCheckSummary(ICO, events);
    const item = s.items.find((i) => i.source === "SP_DLZNICI")!;
    assert.equal(item.state, "RUNNING");
    assert.equal(s.isRunning, true);
  });

  it("RUNNING older than timeout converts to UNAVAILABLE", () => {
    const events = [
      makeEvent("SP_DLZNICI", {
        state: "RUNNING",
        createdAt: new Date(Date.now() - LIVE_CHECK_RUNNING_TIMEOUT_MS - 60 * 1000),
      }),
    ];
    const s = buildLiveCheckSummary(ICO, events);
    const item = s.items.find((i) => i.source === "SP_DLZNICI")!;
    assert.equal(item.state, "UNAVAILABLE");
    assert.equal(s.isRunning, false);
  });

  it("DEBT items sum into totalDebtEur; UNAVAILABLE never counts as clean", () => {
    const events = [
      makeEvent("SP_DLZNICI", { state: "DEBT", severity: "HIGH", amount: 1250.5 }),
      makeEvent("VSZP_DLZNICI", { state: "CLEAN", severity: "INFO" }),
      makeEvent("DOVERA_DLZNICI", { state: "UNAVAILABLE", severity: "LOW" }),
    ];
    const s = buildLiveCheckSummary(ICO, events);
    assert.equal(s.debtCount, 1);
    assert.equal(s.cleanCount, 1);
    assert.equal(s.unavailableCount, 1);
    assert.equal(s.totalDebtEur, 1250.5);
  });

  it("picks newest event per source", () => {
    const events = [
      makeEvent("SP_DLZNICI", { state: "DEBT", severity: "HIGH", createdAt: new Date(Date.now() - 3600_000) }),
      makeEvent("SP_DLZNICI", { state: "CLEAN", severity: "INFO", createdAt: new Date() }),
    ];
    const s = buildLiveCheckSummary(ICO, events);
    const item = s.items.find((i) => i.source === "SP_DLZNICI")!;
    assert.equal(item.state, "CLEAN");
    assert.equal(s.debtCount, 0);
  });

  it("timeout is at least 300s (7-registry Playwright run can take 60-180s)", () => {
    assert.ok(LIVE_CHECK_RUNNING_TIMEOUT_MS >= 300 * 1000);
  });
});
