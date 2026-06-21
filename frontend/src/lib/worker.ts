// Klient pre komunikáciu s Python workerom.

const WORKER_URL = process.env.WORKER_URL ?? "http://localhost:8000";
const WORKER_SECRET = process.env.WORKER_SECRET;

export interface EnqueueTaskPayload {
  reportRequestId: string;
  targetType: "COMPANY" | "PERSON";
  ico?: string;
  name?: string;
  surname?: string;
  birthDate?: string;
  sources: string[];
}

export async function enqueueReportTask(payload: EnqueueTaskPayload) {
  const workerPayload = {
    report_request_id: payload.reportRequestId,
    target_type: payload.targetType,
    ico: payload.ico,
    name: payload.name,
    surname: payload.surname,
    birth_date: payload.birthDate,
    sources: payload.sources,
  };

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (WORKER_SECRET) {
    headers["x-worker-secret"] = WORKER_SECRET;
  }

  const res = await fetch(`${WORKER_URL}/tasks`, {
    method: "POST",
    headers,
    body: JSON.stringify(workerPayload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "Worker error");
    throw new Error(`Worker returned ${res.status}: ${text}`);
  }

  return (await res.json()) as { taskId: string };
}
