// Klient pre komunikáciu s Python workerom.

const WORKER_URL = process.env.WORKER_URL ?? "http://localhost:8000";
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
  };

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (WORKER_SECRET) {
    headers["x-worker-secret"] = WORKER_SECRET;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  let res: Response;
  try {
    res = await fetch(`${WORKER_URL}/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify(workerPayload),
      signal: controller.signal,
    });
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === "AbortError" || error.message?.includes("aborted")) {
      throw new Error(`Worker (Python) na adrese ${WORKER_URL} neodpovedá (Timeout 8s). Zrejme nebeží, alebo je port (napr. 8000) obsadený iným systémovým procesom. Uistite sa, že Worker je zapnutý.`);
    }
    throw error;
  }
  clearTimeout(timeoutId);

  if (!res.ok) {
    const text = await res.text().catch(() => "Worker error");
    throw new Error(`Worker returned ${res.status}: ${text}`);
  }

  return (await res.json()) as { taskId: string };
}

export async function checkWorkerHealth(): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2000); // 2 sec timeout for health check
  try {
    const res = await fetch(`${WORKER_URL}/health`, { signal: controller.signal });
    clearTimeout(timeoutId);
    return res.ok;
  } catch {
    clearTimeout(timeoutId);
    return false;
  }
}
