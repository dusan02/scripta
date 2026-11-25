/**
 * Unit & contract tests for P0.1 Webhook Reliability:
 * - Reverse-proxy IP extraction & IPv4-mapped IPv6 normalization
 * - Paddle /ips CIDR parsing & allowlisting
 * - Unfulfilled vs out-of-order guest refund retry handling
 * - Svix webhook HMAC signature verification (used by /api/email/events & inbound)
 * - GuestCheckout atomic claim, duplicate idempotency, and stale FULFILLING recovery
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "module";
import { NextRequest } from "next/server";
import { Webhook } from "svix";

import {
  extractWebhookClientIp,
  fetchPaddleIpsWithFallback,
  isAllowedPaddleIp,
  isWebhookSignatureError,
  normalizeClientIp,
  normalizePaddleIpList,
  PADDLE_IP_FETCH_TIMEOUT_MS,
  PADDLE_IP_TTL_MS,
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

// ---------------------------------------------------------------------------
// Nginx $verifa_junk_ua / $verifa_farm_block map & route handler security
// ---------------------------------------------------------------------------

/**
 * Parse a `map <expr> $varName { ... }` block from an Nginx conf snippet and
 * evaluate it using Nginx map precedence (exact default + first regex match wins).
 */
function parseNginxMapEntries(conf: string, varName: string): { defaultVal: string; regexes: Array<[RegExp, string]> } {
  const escaped = varName.replace("$", "\\$");
  const blockMatch = conf.match(new RegExp(`map\\s+"[^"]+"\\s+${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`, "m"));
  assert.ok(blockMatch, `Missing Nginx map block for ${varName}`);
  let defaultVal = "";
  const regexes: Array<[RegExp, string]> = [];
  for (const rawLine of blockMatch[1].split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    assert.ok(line.endsWith(";"), `Nginx map directive line missing semicolon: ${line}`);
    const body = line.slice(0, -1).trim();
    if (body.startsWith("default ")) {
      defaultVal = body.slice("default ".length).trim();
      continue;
    }
    // Strip optional quotes around regex pattern token
    const m = body.match(/^"?(~[*]?)(.+?)"?\s+(\S+)$/);
    assert.ok(m, `Could not parse Nginx map rule: ${line}`);
    const flags = m[1] === "~*" ? "i" : "";
    regexes.push([new RegExp(m[2], flags), m[3]]);
  }
  return { defaultVal, regexes };
}

function evalNginxMap(mapDef: { defaultVal: string; regexes: Array<[RegExp, string]> }, input: string): string {
  for (const [re, out] of mapDef.regexes) {
    if (re.test(input)) return out;
  }
  return mapDef.defaultVal;
}

/** Mimic Nginx $uri normalization (strip query string, collapse //, resolve /./ & /../). */
function normalizeNginxUri(rawPath: string): string {
  const withoutQuery = rawPath.split("?")[0];
  const segments: string[] = [];
  for (const part of withoutQuery.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      segments.pop();
    } else {
      segments.push(part);
    }
  }
  return "/" + segments.join("/") + (withoutQuery.endsWith("/") && segments.length > 0 ? "/" : "");
}

describe("Nginx Verifa-only webhook UA & farm ASN exemption (P0.1)", () => {
  const repoRoot = path.resolve(process.cwd(), "..");
  const limitsPath = path.join(repoRoot, "deploy/nginx/conf.d_zz-verifa-limits.conf");
  const vhostPath = path.join(repoRoot, "deploy/nginx/sites-enabled_verifa.sk");
  const patchPath = path.join(repoRoot, "deploy/nginx/p0_1_nginx_webhooks.patch");

  // Shared VPS conf.d/zz-junk-filter.conf regex list (never modified by Etapa 1)
  const sharedJunkUaRegexes: Array<[RegExp, string]> = [
    /^89\.185\.250\.213 /,
    /^95\.102\. /,
  ]
    .map((re): [RegExp, string] => [re, "0"])
    .concat(
      [
        /python-requests/i, /python-urllib/i, /curl\//i, /wget\//i, /libwww-perl/i,
        /PhantomJS/i, /scrapy/i, /zgrab/i, /masscan/i, /nmap/i, /nuclei/i,
        /Go-http-client/i, /Apache-HttpClient/i, /okhttp/i, /Java\//i,
        /axios\//i, /node-fetch/i, /undici/i, /httpie/i, /got\//i,
      ].map((re): [RegExp, string] => [re, "1"])
    );

  function evaluateVerifaRequest(opts: {
    remoteAddr?: string;
    userAgent: string;
    method: string;
    requestUri: string;
    farmBlock?: "0" | "1";
  }): { status: 200 | 403 | 404; verifaJunkUa: string; verifaFarmBlock: string } {
    const limitsConf = fs.readFileSync(limitsPath, "utf8");
    const vhostConf = fs.readFileSync(vhostPath, "utf8");
    const junkMap = parseNginxMapEntries(limitsConf, "$verifa_junk_ua");
    const farmMap = parseNginxMapEntries(limitsConf, "$verifa_farm_block");

    const addr = opts.remoteAddr ?? "34.237.3.244";
    const uri = normalizeNginxUri(opts.requestUri);
    const junkUa = evalNginxMap({ defaultVal: "0", regexes: sharedJunkUaRegexes }, `${addr} ${opts.userAgent}`);
    const farmBlock = opts.farmBlock ?? "0";

    const verifaJunkUa = evalNginxMap(junkMap, `${junkUa}:${opts.method}:${uri}`);
    const verifaFarmBlock = evalNginxMap(farmMap, `${farmBlock}:${opts.method}:${uri}`);

    // Server-level `if` rewrites execute before `location` matching
    if (verifaJunkUa === "1" || verifaFarmBlock === "1") {
      return { status: 403, verifaJunkUa, verifaFarmBlock };
    }

    // Parse scanner location ~* regexes directly from sites-enabled_verifa.sk
    const locMatches = Array.from(vhostConf.matchAll(/location\s+~\*\s+(\S+)\s*\{\s*return\s+404;\s*\}/g));
    assert.equal(locMatches.length, 2, "Verifa vhost must preserve both scanner location ~* 404 blocks");
    const scannerRegexes = locMatches.map((m) => new RegExp(m[1], "i"));
    if (scannerRegexes.some((re) => re.test(uri))) {
      return { status: 404, verifaJunkUa, verifaFarmBlock };
    }

    return { status: 200, verifaJunkUa, verifaFarmBlock };
  }

  it("keeps braces balanced and leaves shared junk/farm configs and other 4 sites untouched", () => {
    const limitsConf = fs.readFileSync(limitsPath, "utf8");
    const vhostConf = fs.readFileSync(vhostPath, "utf8");
    const patch = fs.readFileSync(patchPath, "utf8");

    for (const [label, text] of [["limits", limitsConf], ["vhost", vhostConf]]) {
      let depth = 0;
      for (const ch of text) {
        if (ch === "{") depth++;
        if (ch === "}") depth--;
        assert.ok(depth >= 0, `${label} has unmatched closing brace`);
      }
      assert.equal(depth, 0, `${label} has unclosed block brace`);
    }

    assert.equal(vhostConf.includes("include /etc/nginx/snippets/junk_filter.conf;"), false);
    assert.equal(vhostConf.includes("include /etc/nginx/snippets/farm_asn_filter.conf;"), false);
    assert.ok(vhostConf.includes("if ($verifa_junk_ua) { return 403; }"));
    assert.ok(vhostConf.includes("if ($verifa_farm_block) { return 403; }"));

    // Verify patch touches ONLY Verifa's 2 config files
    const touchedFiles = Array.from(patch.matchAll(/^\+\+\+ b\/(.+)$/gm)).map((m) => m[1]);
    assert.deepEqual(touchedFiles, [
      "etc/nginx/conf.d/zz-verifa-limits.conf",
      "etc/nginx/sites-enabled/verifa.sk",
    ]);
    assert.equal(patch.includes("zz-junk-filter.conf") && touchedFiles.some((f) => f.includes("junk")), false);
  });

  it("Scenario 1: Paddle + Go-http-client UA passes UA filter & farm ASN filter on POST /api/billing/webhook", () => {
    const res = evaluateVerifaRequest({
      userAgent: "Go-http-client/1.1",
      method: "POST",
      requestUri: "/api/billing/webhook",
      farmBlock: "1",
    });
    assert.equal(res.status, 200);
    assert.equal(res.verifaJunkUa, "0");
    assert.equal(res.verifaFarmBlock, "0");
  });

  it("Scenario 2: Resend/Svix + axios UA passes UA filter & farm ASN filter on /api/email/{events,inbound}", () => {
    for (const endpoint of ["/api/email/events", "/api/email/inbound", "/api/email/inbound/"]) {
      const res = evaluateVerifaRequest({
        userAgent: "axios/1.6.8",
        method: "POST",
        requestUri: endpoint,
        farmBlock: "1",
      });
      assert.equal(res.status, 200, `${endpoint} must pass`);
      assert.equal(res.verifaJunkUa, "0");
      assert.equal(res.verifaFarmBlock, "0");
    }
  });

  it("Scenario 3: Regular visitor/scraper + curl UA remains 403 blocked on pages", () => {
    for (const pagePath of ["/", "/firma/35876832", "/en/firma/35876832", "/cennik"]) {
      const res = evaluateVerifaRequest({
        remoteAddr: "203.0.113.10",
        userAgent: "curl/8.5.0",
        method: "GET",
        requestUri: pagePath,
      });
      assert.equal(res.status, 403, `${pagePath} with curl UA must return 403`);
      assert.equal(res.verifaJunkUa, "1");
    }
  });

  it("Scenario 4: GET/HEAD/PUT on webhook endpoints cannot bypass UA or farm filter", () => {
    for (const endpoint of ["/api/billing/webhook", "/api/email/events", "/api/email/inbound"]) {
      for (const method of ["GET", "HEAD", "PUT", "DELETE"]) {
        const res = evaluateVerifaRequest({
          remoteAddr: "203.0.113.10",
          userAgent: "Go-http-client/1.1",
          method,
          requestUri: endpoint,
          farmBlock: "1",
        });
        assert.equal(res.status, 403, `${method} ${endpoint} must be blocked`);
      }
    }
  });

  it("Scenario 5: POST to non-webhook API routes or path suffixes with undici UA remains 403 blocked", () => {
    for (const target of [
      "/api/reports",
      "/api/billing/checkout",
      "/api/billing/webhook/extra",
      "/api/billing/webhook2",
      "/api/email/events/extra",
      "/api/email/inbound/../../reports",
    ]) {
      const res = evaluateVerifaRequest({
        remoteAddr: "203.0.113.10",
        userAgent: "undici",
        method: "POST",
        requestUri: target,
      });
      assert.equal(res.status, 403, `POST ${target} with undici UA must be blocked`);
    }
  });

  it("preserves scanner 404 location blocks for normal browser UAs", () => {
    for (const probe of ["/.env", "/.git/config", "/wp-login.php", "/backup.sql"]) {
      const res = evaluateVerifaRequest({
        remoteAddr: "203.0.113.10",
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        method: "GET",
        requestUri: probe,
      });
      assert.equal(res.status, 404, `${probe} must return 404`);
    }
  });
});

describe("Webhook route cryptographic rejection (Scenarios 6 & 7)", () => {
  const realFetch = globalThis.fetch;
  const savedEnv = {
    BILLING_PROVIDER: process.env.BILLING_PROVIDER,
    PADDLE_ENVIRONMENT: process.env.PADDLE_ENVIRONMENT,
    PADDLE_API_KEY: process.env.PADDLE_API_KEY,
    PADDLE_WEBHOOK_SECRET: process.env.PADDLE_WEBHOOK_SECRET,
    RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET,
  };

  beforeEach(() => {
    process.env.BILLING_PROVIDER = "paddle";
    process.env.PADDLE_ENVIRONMENT = "sandbox";
    process.env.PADDLE_API_KEY = "test_paddle_api_key";
    process.env.PADDLE_WEBHOOK_SECRET = "pdl_ntfset_test_secret_123456";
    process.env.RESEND_WEBHOOK_SECRET = "whsec_dGVzdC1zZWNyZXQtd2ViaG9vay1rZXktMTIzNDU2";
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/ips")) {
        return new Response(
          JSON.stringify({ data: { ipv4_cidrs: ["34.237.3.244/32", "34.195.105.136/32"] } }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      throw new Error(`Unexpected fetch during webhook route test: ${url}`);
    };
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("distinguishes webhook signature errors (403) from non-signature payload errors (400)", () => {
    assert.equal(isWebhookSignatureError(new Error("[Paddle] Webhook signature verification failed")), true);
    assert.equal(isWebhookSignatureError(new Error("[Paddle] Invalid webhook signature")), true);
    assert.equal(isWebhookSignatureError(new Error("Unexpected token in JSON payload")), false);
  });

  it("enforces AbortSignal.timeout(2500) on Paddle /ips and falls back cleanly on timeout/error", async () => {
    assert.equal(PADDLE_IP_FETCH_TIMEOUT_MS, 2500);

    let capturedSignal: AbortSignal | undefined;
    const hangingFetch: typeof fetch = (_input, init) => {
      capturedSignal = init?.signal ?? undefined;
      return new Promise((_resolve, reject) => {
        if (!init?.signal) return reject(new Error("Missing AbortSignal"));
        if (init.signal.aborted) return reject(init.signal.reason);
        init.signal.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
      });
    };

    // Cold cache timeout -> falls back to empty allowlist (signature verification still runs)
    const coldRes = await fetchPaddleIpsWithFallback({
      environment: "production",
      cache: null,
      timeoutMs: 25,
      fetchImpl: hangingFetch,
    });
    assert.ok(capturedSignal instanceof AbortSignal);
    assert.equal(capturedSignal.aborted, true);
    assert.deepEqual(coldRes.ips, []);
    assert.equal(coldRes.stale, false);
    assert.equal(coldRes.cache, null);

    // Expired cache timeout -> keeps last known-good allowlist (stale-while-error)
    const expiredCache = { ips: ["34.237.3.244"], fetchedAt: 1000 };
    const staleRes = await fetchPaddleIpsWithFallback({
      environment: "production",
      cache: expiredCache,
      now: 1000 + PADDLE_IP_TTL_MS + 5000,
      timeoutMs: 25,
      fetchImpl: hangingFetch,
    });
    assert.deepEqual(staleRes.ips, ["34.237.3.244"]);
    assert.equal(staleRes.stale, true);
    assert.equal(isAllowedPaddleIp("34.237.3.244", staleRes.ips), true);
    assert.equal(isAllowedPaddleIp("203.0.113.99", staleRes.ips), false);
  });

  it("accepts a validly signed Paddle webhook (HTTP 200) even when cold /ips fetch times out", async () => {
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/ips")) {
        assert.ok(init?.signal instanceof AbortSignal, "fetch must pass AbortSignal.timeout");
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      }
      throw new Error(`Unexpected fetch during cold timeout test: ${url}`);
    };

    const { POST } = await import("@/app/api/billing/webhook/route");
    const ts = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({
      event_id: "evt_timeout_fallback_1",
      event_type: "customer.created",
      occurred_at: new Date(ts * 1000).toISOString(),
      data: { id: "ctm_test_1", email: "ok@verifa.sk", status: "active" },
    });
    const h1 = crypto
      .createHmac("sha256", process.env.PADDLE_WEBHOOK_SECRET!)
      .update(`${ts}:${body}`)
      .digest("hex");

    const req = new NextRequest("https://verifa.sk/api/billing/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Go-http-client/1.1",
        "x-real-ip": "34.237.3.244",
        "paddle-signature": `ts=${ts};h1=${h1}`,
      },
      body,
    });
    const res = await POST(req);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.received, true);
  });

  it("Scenario 6: rejects forged or malformed Paddle-Signature with HTTP 403", async () => {
    const { POST } = await import("@/app/api/billing/webhook/route");
    const ts = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ event_type: "transaction.completed", data: { id: "txn_forged" } });

    const forgedReq = new NextRequest("https://verifa.sk/api/billing/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Go-http-client/1.1",
        "x-real-ip": "34.237.3.244",
        "paddle-signature": `ts=${ts};h1=0000000000000000000000000000000000000000000000000000000000000000`,
      },
      body,
    });
    const forgedRes = await POST(forgedReq);
    assert.equal(forgedRes.status, 403);

    const malformedSigReq = new NextRequest("https://verifa.sk/api/billing/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-real-ip": "34.237.3.244",
        "paddle-signature": "malformed-not-ts-h1",
      },
      body,
    });
    assert.equal((await POST(malformedSigReq)).status, 403);

    const badIpReq = new NextRequest("https://verifa.sk/api/billing/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-real-ip": "203.0.113.99",
        "paddle-signature": `ts=${ts};h1=abc`,
      },
      body,
    });
    const badIpRes = await POST(badIpReq);
    assert.equal(badIpRes.status, 403);
  });

  it("Scenario 7: rejects invalid Svix signatures on /api/email/events and /api/email/inbound with HTTP 401", async () => {
    const { POST: eventsPost } = await import("@/app/api/email/events/route");
    const { POST: inboundPost } = await import("@/app/api/email/inbound/route");
    const now = new Date();
    const ts = String(Math.floor(now.getTime() / 1000));

    const badEventsReq = new NextRequest("https://verifa.sk/api/email/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "axios/1.6.8",
        "svix-id": "msg_bad_1",
        "svix-timestamp": ts,
        "svix-signature": "v1,invalidsignaturebase64==",
      },
      body: JSON.stringify({ type: "email.bounced", created_at: now.toISOString(), email: { email: "x@y.sk", from: "a@verifa.sk" } }),
    });
    assert.equal((await eventsPost(badEventsReq)).status, 401);

    const badInboundReq = new NextRequest("https://verifa.sk/api/email/inbound", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "axios/1.6.8",
        "svix-id": "msg_bad_2",
        "svix-timestamp": ts,
        "svix-signature": "v1,invalidsignaturebase64==",
      },
      body: JSON.stringify({ type: "email.received", created_at: now.toISOString(), data: { email_id: "e1", from: "u@x.sk", to: ["reply+u1@inbound.verifa.sk"], subject: "Re:" } }),
    });
    assert.equal((await inboundPost(badInboundReq)).status, 401);

    // Control check: authentic Svix HMAC succeeds cleanly (200) for non-DB event
    const wh = new Webhook(process.env.RESEND_WEBHOOK_SECRET!);
    const validPayload = JSON.stringify({ type: "email.delivered", created_at: now.toISOString(), email: { email: "ok@verifa.sk", from: "noreply@verifa.sk" } });
    const validSig = wh.sign("msg_ok_1", now, validPayload);
    const validEventsReq = new NextRequest("https://verifa.sk/api/email/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "axios/1.6.8",
        "svix-id": "msg_ok_1",
        "svix-timestamp": ts,
        "svix-signature": validSig,
      },
      body: validPayload,
    });
    assert.equal((await eventsPost(validEventsReq)).status, 200);
  });
});
