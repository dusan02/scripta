// Klient pre komunikáciu s Python workerom.

const WORKER_URL = process.env.WORKER_URL;
if (!WORKER_URL && process.env.NODE_ENV === "production" && process.env.NEXT_PHASE === "phase-production-server") {
  throw new Error("[WORKER] WORKER_URL must be set in production — refusing to start with localhost fallback.");
}
const WORKER_URL_RESOLVED = WORKER_URL || "http://localhost:8000";
const WORKER_SECRET = process.env.WORKER_SECRET;

export interface EnqueueTaskPayload {
  reportRequestId: string;
  targetType: "COMPANY";
  ico?: string;
  sources: string[];
  orsrExtractType?: string;
  crzDateFrom?: string | null;
  rozhodnutiaDateFrom?: string | null;
  vestnikDateFrom?: string | null;
  reportLanguage?: string;
  attachmentsConfig?: Record<string, boolean> | null;
}

export async function enqueueReportTask(payload: EnqueueTaskPayload) {
  const workerPayload = {
    report_request_id: payload.reportRequestId,
    target_type: payload.targetType,
    ico: payload.ico,
    sources: payload.sources,
    orsr_extract_type: payload.orsrExtractType ?? "CURRENT",
    crz_date_from: payload.crzDateFrom ?? null,
    rozhodnutia_date_from: payload.rozhodnutiaDateFrom ?? null,
    vestnik_date_from: payload.vestnikDateFrom ?? null,
    report_language: payload.reportLanguage ?? "sk",
    attachments_config: payload.attachmentsConfig ?? null,
  };

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (WORKER_SECRET) {
    headers["x-worker-secret"] = WORKER_SECRET;
  }

  // Retry with exponential backoff — transient network blips should not fail report creation.
  const maxRetries = 3;
  const baseTimeoutMs = parseInt(process.env.WORKER_TIMEOUT_MS || "8000", 10);
  const retryDelays = [500, 1500, 3000];

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), baseTimeoutMs);

    let res: Response;
    try {
      res = await fetch(`${WORKER_URL_RESOLVED}/tasks`, {
        method: "POST",
        headers,
        body: JSON.stringify(workerPayload),
        signal: controller.signal,
      });
    } catch (error: any) {
      clearTimeout(timeoutId);
      lastError = error;
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, retryDelays[attempt]));
        continue;
      }
      if (error.name === "AbortError" || error.message?.includes("aborted")) {
        throw new Error(`Worker (Python) na adrese ${WORKER_URL_RESOLVED} neodpovedá (Timeout ${baseTimeoutMs / 1000}s po ${maxRetries + 1} pokusoch). Zrejme nebeží, alebo je port (napr. 8000) obsadený iným systémovým procesom. Uistite sa, že Worker je zapnutý.`);
      }
      throw error;
    }
    clearTimeout(timeoutId);

    if (!res.ok) {
      const text = await res.text().catch(() => "Worker error");
      // 5xx errors are retryable (worker temporarily overloaded)
      if (res.status >= 500 && attempt < maxRetries) {
        lastError = new Error(`Worker returned ${res.status}: ${text}`);
        await new Promise(r => setTimeout(r, retryDelays[attempt]));
        continue;
      }
      throw new Error(`Worker returned ${res.status}: ${text}`);
    }

    return (await res.json()) as { taskId: string };
  }

  throw lastError || new Error("Worker enqueue failed after retries");
}

// Cache health check result for 5 seconds to avoid hitting worker on every report request
let cachedHealth: { result: boolean; timestamp: number } | null = null;
const HEALTH_CACHE_MS = 5000;

export async function checkWorkerHealth(): Promise<boolean> {
  // Return cached result if fresh
  if (cachedHealth && Date.now() - cachedHealth.timestamp < HEALTH_CACHE_MS) {
    return cachedHealth.result;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2000); // 2 sec timeout for health check
  try {
    const res = await fetch(`${WORKER_URL_RESOLVED}/health`, { signal: controller.signal });
    clearTimeout(timeoutId);
    const result = res.ok;
    cachedHealth = { result, timestamp: Date.now() };
    return result;
  } catch {
    clearTimeout(timeoutId);
    cachedHealth = { result: false, timestamp: Date.now() };
    return false;
  }
}
