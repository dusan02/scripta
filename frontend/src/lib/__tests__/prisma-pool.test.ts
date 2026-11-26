/**
 * Stream 1 – Frontend & Prisma Stability unit tests:
 *  - Prisma connection pool URL normalization, bounds clamping, env overrides, redaction
 *  - Bounded single-flight DB healthcheck helper (timeout, late rejection safety, coalescing, TTL cache)
 *  - Docker Compose & Dockerfile PID/zombie/healthcheck invariants
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";

import {
  buildPrismaDatasourceUrl,
  redactDatabaseUrl,
  resolvePrismaPoolConfig,
  DEFAULT_APPLICATION_NAME,
  DEFAULT_CONNECT_TIMEOUT_SECONDS,
  DEFAULT_CONNECTION_LIMIT,
  DEFAULT_POOL_TIMEOUT_SECONDS,
  MAX_CONNECTION_LIMIT,
  MAX_POOL_TIMEOUT_SECONDS,
  MIN_CONNECTION_LIMIT,
  MIN_POOL_TIMEOUT_SECONDS,
} from "@/lib/prisma-pool";
import { createDbHealthChecker } from "@/lib/db-health";

const REPO_ROOT = path.resolve(process.cwd(), "..");

describe("prisma-pool URL normalization and guardrails", () => {
  it("applies safe defaults when DATABASE_URL has no pool params", () => {
    const out = buildPrismaDatasourceUrl("postgresql://user:pass@postgres:5432/verifa", {});
    assert.ok(out);
    const parsed = new URL(out);
    assert.equal(parsed.searchParams.get("connection_limit"), String(DEFAULT_CONNECTION_LIMIT));
    assert.equal(parsed.searchParams.get("pool_timeout"), String(DEFAULT_POOL_TIMEOUT_SECONDS));
    assert.equal(
      parsed.searchParams.get("connect_timeout"),
      String(DEFAULT_CONNECT_TIMEOUT_SECONDS)
    );
    assert.equal(parsed.searchParams.get("application_name"), DEFAULT_APPLICATION_NAME);
  });

  it("preserves valid explicit URL params while backfilling missing ones", () => {
    const out = buildPrismaDatasourceUrl(
      "postgresql://user:pass@postgres:5432/verifa?connection_limit=25&sslmode=prefer",
      {}
    );
    assert.ok(out);
    const parsed = new URL(out);
    assert.equal(parsed.searchParams.get("connection_limit"), "25");
    assert.equal(parsed.searchParams.get("pool_timeout"), String(DEFAULT_POOL_TIMEOUT_SECONDS));
    assert.equal(
      parsed.searchParams.get("connect_timeout"),
      String(DEFAULT_CONNECT_TIMEOUT_SECONDS)
    );
    assert.equal(parsed.searchParams.get("application_name"), DEFAULT_APPLICATION_NAME);
    assert.equal(parsed.searchParams.get("sslmode"), "prefer");
  });

  it("clamps out-of-range URL params to safe bounds", () => {
    const tooHigh = buildPrismaDatasourceUrl(
      "postgresql://user:pass@postgres:5432/verifa?connection_limit=500&pool_timeout=999",
      {}
    );
    const highParsed = new URL(tooHigh!);
    assert.equal(highParsed.searchParams.get("connection_limit"), String(MAX_CONNECTION_LIMIT));
    assert.equal(highParsed.searchParams.get("pool_timeout"), String(MAX_POOL_TIMEOUT_SECONDS));

    const tooLow = buildPrismaDatasourceUrl(
      "postgresql://user:pass@postgres:5432/verifa?connection_limit=0&pool_timeout=0",
      {}
    );
    const lowParsed = new URL(tooLow!);
    assert.equal(lowParsed.searchParams.get("connection_limit"), String(MIN_CONNECTION_LIMIT));
    assert.equal(lowParsed.searchParams.get("pool_timeout"), String(MIN_POOL_TIMEOUT_SECONDS));
  });

  it("lets PRISMA_* environment variables override URL params (still clamped)", () => {
    const out = buildPrismaDatasourceUrl(
      "postgresql://user:pass@postgres:5432/verifa?connection_limit=30&pool_timeout=10",
      {
        PRISMA_CONNECTION_LIMIT: "18",
        PRISMA_POOL_TIMEOUT: "20",
        PRISMA_CONNECT_TIMEOUT: "7",
        PRISMA_APPLICATION_NAME: "verifa_web_prod",
      }
    );
    const parsed = new URL(out!);
    assert.equal(parsed.searchParams.get("connection_limit"), "18");
    assert.equal(parsed.searchParams.get("pool_timeout"), "20");
    assert.equal(parsed.searchParams.get("connect_timeout"), "7");
    assert.equal(parsed.searchParams.get("application_name"), "verifa_web_prod");
  });

  it("ignores invalid non-numeric env values and falls back cleanly", () => {
    const cfg = resolvePrismaPoolConfig({
      PRISMA_CONNECTION_LIMIT: "abc",
      PRISMA_POOL_TIMEOUT: "15s",
      PRISMA_CONNECT_TIMEOUT: "",
      PRISMA_APPLICATION_NAME: "   ",
    });
    assert.equal(cfg.connectionLimit, DEFAULT_CONNECTION_LIMIT);
    assert.equal(cfg.poolTimeoutSeconds, DEFAULT_POOL_TIMEOUT_SECONDS);
    assert.equal(cfg.connectTimeoutSeconds, DEFAULT_CONNECT_TIMEOUT_SECONDS);
    assert.equal(cfg.applicationName, DEFAULT_APPLICATION_NAME);
  });

  it("handles undefined, empty, and non-postgres URLs without throwing", () => {
    assert.equal(buildPrismaDatasourceUrl(undefined, {}), undefined);
    assert.equal(buildPrismaDatasourceUrl("   ", {}), undefined);
    assert.equal(buildPrismaDatasourceUrl("not-a-url", {}), "not-a-url");
    assert.equal(buildPrismaDatasourceUrl("mysql://u:p@host/db", {}), "mysql://u:p@host/db");
  });

  it("redacts credentials while preserving host and pool query params", () => {
    const redacted = redactDatabaseUrl(
      "postgresql://verifa:supersecret@postgres:5432/verifa?connection_limit=20&pool_timeout=15"
    );
    assert.ok(!redacted.includes("supersecret"), "password must be redacted");
    assert.ok(!redacted.includes("verifa:"), "username must be redacted");
    assert.ok(redacted.includes("postgres:5432/verifa"));
    assert.ok(redacted.includes("connection_limit=20"));
    assert.equal(redactDatabaseUrl(undefined), "<unset>");
  });
});

describe("createDbHealthChecker concurrency and timeout guardrails", () => {
  it("returns ok:true on fast probe and serves subsequent calls from TTL cache", async () => {
    let calls = 0;
    let fakeNow = 1000;
    const check = createDbHealthChecker(
      async () => {
        calls++;
        return 1;
      },
      { timeoutMs: 200, okCacheTtlMs: 2000, now: () => fakeNow }
    );

    const r1 = await check();
    assert.equal(r1.ok, true);
    assert.equal(r1.cached, false);
    assert.equal(calls, 1);

    fakeNow += 500;
    const r2 = await check();
    assert.equal(r2.ok, true);
    assert.equal(r2.cached, true);
    assert.equal(calls, 1);

    fakeNow += 2000;
    const r3 = await check();
    assert.equal(r3.ok, true);
    assert.equal(r3.cached, false);
    assert.equal(calls, 2);
  });

  it("coalesces concurrent in-flight probes into a single DB query", async () => {
    let calls = 0;
    let resolveProbe!: () => void;
    const check = createDbHealthChecker(
      () => {
        calls++;
        return new Promise<void>((resolve) => {
          resolveProbe = resolve;
        });
      },
      { timeoutMs: 500, okCacheTtlMs: 0 }
    );

    const pending = Promise.all([check(), check(), check(), check(), check()]);
    await new Promise((r) => setImmediate(r));
    resolveProbe();
    const results = await pending;

    assert.equal(calls, 1, "5 concurrent health probes must share 1 DB query");
    assert.ok(results.every((r) => r.ok === true));
  });

  it("times out cleanly and swallows late probe rejections without crashing", async () => {
    let rejectLate!: (err: Error) => void;
    const check = createDbHealthChecker(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectLate = reject;
        }),
      { timeoutMs: 30, errorCacheTtlMs: 0 }
    );

    // Keep the Node 20 event loop alive while awaiting an unref'd timeout timer
    // (simulates a real pending DB socket that keeps the loop ref'd).
    const keepAlive = setTimeout(() => {}, 5000);
    try {
      const res = await check();
      assert.equal(res.ok, false);
    } finally {
      clearTimeout(keepAlive);
    }

    // Trigger late rejection after timeout already resolved; should not cause unhandledRejection
    rejectLate(new Error("late P2024 error"));
    await new Promise((r) => setTimeout(r, 10));
  });
});

describe("Stream 1 container and Dockerfile stability invariants", () => {
  it("docker-compose.yml frontend has init: true, bounded limits, pool params, and shell-less healthcheck", () => {
    const compose = fs.readFileSync(path.join(REPO_ROOT, "docker-compose.yml"), "utf8");
    const frontendSection = compose.slice(
      compose.indexOf("container_name: verifa_frontend"),
      compose.indexOf("container_name: verifa_redis")
    );
    assert.ok(frontendSection.includes("init: true"), "frontend must enable native Docker init: true");
    assert.ok(frontendSection.includes("pids_limit: 200"), "pids_limit must stay bounded at 200");
    assert.ok(frontendSection.includes("mem_limit: 1536m"), "mem_limit must stay bounded at 1536m");
    assert.ok(
      !frontendSection.includes("UV_THREADPOOL_SIZE"),
      "avoid redundant UV_THREADPOOL_SIZE=4 (Node.js default is 4)"
    );
    assert.ok(frontendSection.includes("pool_timeout="), "DATABASE_URL must specify pool_timeout");
    assert.ok(frontendSection.includes("connect_timeout="), "DATABASE_URL must specify connect_timeout");
    assert.ok(
      frontendSection.includes("application_name=verifa_frontend"),
      "DATABASE_URL must tag application_name for pg_stat_activity visibility"
    );
    assert.ok(
      frontendSection.includes('test: ["CMD", "node", "-e"'),
      "healthcheck should use exec-form CMD (no /bin/sh wrapper)"
    );
    assert.ok(frontendSection.includes("AbortSignal.timeout"), "healthcheck fetch must be timeout-bounded");
    assert.ok(frontendSection.includes("process.exit(r.ok?0:1)"), "healthcheck must explicitly exit");
  });

  it("frontend/Dockerfile relies on Compose init: true without redundant double-tini", () => {
    const dockerfile = fs.readFileSync(path.join(REPO_ROOT, "frontend/Dockerfile"), "utf8");
    const runnerStage = dockerfile.slice(dockerfile.indexOf("AS runner"));
    assert.ok(
      !runnerStage.includes('ENTRYPOINT ["/usr/bin/tini"'),
      "avoid redundant double-tini when Compose sets init: true"
    );
    assert.ok(runnerStage.includes('CMD ["node", "server.js"]'), "runner starts node server.js cleanly");
  });

  it("exec-form healthcheck command exits cleanly on 200 and aborts promptly on stalled endpoint", async () => {
    const http = await import("node:http");
    const { spawn } = await import("node:child_process");

    const runProbe = (url: string, timeoutMs: number) =>
      new Promise<{ code: number | null; elapsedMs: number }>((resolve) => {
        const start = Date.now();
        const expr = `fetch(${JSON.stringify(url)},{signal:AbortSignal.timeout(${timeoutMs})}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))`;
        const child = spawn(process.execPath, ["-e", expr], { stdio: "ignore" });
        child.on("exit", (code) => resolve({ code, elapsedMs: Date.now() - start }));
      });

    const server = http.createServer((req, res) => {
      if (req.url === "/ok") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"status":"ok"}');
      } else if (req.url === "/stall") {
        // Intentionally never responds to simulate stalled DB pool
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address() as { port: number };
    try {
      const okRes = await runProbe(`http://127.0.0.1:${addr.port}/ok`, 1000);
      assert.equal(okRes.code, 0, "healthy probe must exit 0");

      const stallRes = await runProbe(`http://127.0.0.1:${addr.port}/stall`, 250);
      assert.equal(stallRes.code, 1, "stalled probe must exit 1 via AbortSignal.timeout");
      assert.ok(stallRes.elapsedMs < 1500, `stalled probe must terminate promptly (took ${stallRes.elapsedMs}ms)`);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});
