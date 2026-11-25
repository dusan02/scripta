/**
 * Prisma PostgreSQL connection pool URL normalization and guardrails.
 *
 * Ensures verifa_frontend runs with bounded, observable pool parameters on a
 * shared 2-vCPU / 7.8GB VPS (PostgreSQL max_connections=100) so traffic bursts
 * do not trigger P2024 connection-pool exhaustion cascades or oversubscribe CPU.
 */

export const DEFAULT_CONNECTION_LIMIT = 20;
export const MIN_CONNECTION_LIMIT = 2;
export const MAX_CONNECTION_LIMIT = 50;

export const DEFAULT_POOL_TIMEOUT_SECONDS = 15;
export const MIN_POOL_TIMEOUT_SECONDS = 2;
export const MAX_POOL_TIMEOUT_SECONDS = 60;

export const DEFAULT_CONNECT_TIMEOUT_SECONDS = 5;
export const MIN_CONNECT_TIMEOUT_SECONDS = 1;
export const MAX_CONNECT_TIMEOUT_SECONDS = 30;

export const DEFAULT_APPLICATION_NAME = "verifa_frontend";

export interface PrismaPoolConfig {
  connectionLimit: number;
  poolTimeoutSeconds: number;
  connectTimeoutSeconds: number;
  applicationName: string;
}

type EnvRecord = Record<string, string | undefined>;

function parseBoundedInt(
  raw: string | null | undefined,
  min: number,
  max: number
): number | undefined {
  if (raw == null) return undefined;
  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(max, Math.max(min, parsed));
}

function sanitizeApplicationName(raw: string | null | undefined): string | undefined {
  if (raw == null) return undefined;
  const cleaned = raw.trim().replace(/[^a-zA-Z0-9_.-]/g, "");
  return cleaned.length > 0 ? cleaned.slice(0, 63) : undefined;
}

export function resolvePrismaPoolConfig(env: EnvRecord = process.env): PrismaPoolConfig {
  return {
    connectionLimit:
      parseBoundedInt(
        env.PRISMA_CONNECTION_LIMIT,
        MIN_CONNECTION_LIMIT,
        MAX_CONNECTION_LIMIT
      ) ?? DEFAULT_CONNECTION_LIMIT,
    poolTimeoutSeconds:
      parseBoundedInt(
        env.PRISMA_POOL_TIMEOUT,
        MIN_POOL_TIMEOUT_SECONDS,
        MAX_POOL_TIMEOUT_SECONDS
      ) ?? DEFAULT_POOL_TIMEOUT_SECONDS,
    connectTimeoutSeconds:
      parseBoundedInt(
        env.PRISMA_CONNECT_TIMEOUT,
        MIN_CONNECT_TIMEOUT_SECONDS,
        MAX_CONNECT_TIMEOUT_SECONDS
      ) ?? DEFAULT_CONNECT_TIMEOUT_SECONDS,
    applicationName:
      sanitizeApplicationName(env.PRISMA_APPLICATION_NAME) ?? DEFAULT_APPLICATION_NAME,
  };
}

/**
 * Normalizes a PostgreSQL DATABASE_URL with safe Prisma pool parameters.
 *
 * Precedence for each parameter:
 *   1. Explicit PRISMA_* environment variable override (clamped to safe bounds)
 *   2. Existing valid query param on rawUrl (clamped to safe bounds)
 *   3. Safe default for this deployment
 */
export function buildPrismaDatasourceUrl(
  rawUrl: string | undefined,
  env: EnvRecord = process.env
): string | undefined {
  if (!rawUrl || rawUrl.trim().length === 0) {
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return rawUrl;
  }

  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    return rawUrl;
  }

  const defaults = resolvePrismaPoolConfig(env);

  const envConnectionLimit = parseBoundedInt(
    env.PRISMA_CONNECTION_LIMIT,
    MIN_CONNECTION_LIMIT,
    MAX_CONNECTION_LIMIT
  );
  const urlConnectionLimit = parseBoundedInt(
    parsed.searchParams.get("connection_limit"),
    MIN_CONNECTION_LIMIT,
    MAX_CONNECTION_LIMIT
  );
  parsed.searchParams.set(
    "connection_limit",
    String(envConnectionLimit ?? urlConnectionLimit ?? defaults.connectionLimit)
  );

  const envPoolTimeout = parseBoundedInt(
    env.PRISMA_POOL_TIMEOUT,
    MIN_POOL_TIMEOUT_SECONDS,
    MAX_POOL_TIMEOUT_SECONDS
  );
  const urlPoolTimeout = parseBoundedInt(
    parsed.searchParams.get("pool_timeout"),
    MIN_POOL_TIMEOUT_SECONDS,
    MAX_POOL_TIMEOUT_SECONDS
  );
  parsed.searchParams.set(
    "pool_timeout",
    String(envPoolTimeout ?? urlPoolTimeout ?? defaults.poolTimeoutSeconds)
  );

  const envConnectTimeout = parseBoundedInt(
    env.PRISMA_CONNECT_TIMEOUT,
    MIN_CONNECT_TIMEOUT_SECONDS,
    MAX_CONNECT_TIMEOUT_SECONDS
  );
  const urlConnectTimeout = parseBoundedInt(
    parsed.searchParams.get("connect_timeout"),
    MIN_CONNECT_TIMEOUT_SECONDS,
    MAX_CONNECT_TIMEOUT_SECONDS
  );
  parsed.searchParams.set(
    "connect_timeout",
    String(envConnectTimeout ?? urlConnectTimeout ?? defaults.connectTimeoutSeconds)
  );

  const envAppName = sanitizeApplicationName(env.PRISMA_APPLICATION_NAME);
  const urlAppName = sanitizeApplicationName(parsed.searchParams.get("application_name"));
  parsed.searchParams.set(
    "application_name",
    envAppName ?? urlAppName ?? defaults.applicationName
  );

  return parsed.toString();
}

/**
 * Redacts credentials from a database URL for safe diagnostic logging.
 */
export function redactDatabaseUrl(rawUrl: string | undefined): string {
  if (!rawUrl) return "<unset>";
  try {
    const parsed = new URL(rawUrl);
    if (parsed.username) parsed.username = "***";
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return "<unparseable>";
  }
}
