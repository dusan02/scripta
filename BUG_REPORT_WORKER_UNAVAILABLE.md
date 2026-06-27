# Bug Report: Worker is unavailable, report marked as failed

## Summary

When the Next.js frontend (`localhost:3000`) is started **without** the Python worker (`localhost:8000`), every report submission immediately fails with:

> `Worker is unavailable, report marked as failed` (HTTP 503)

This happens because the frontend synchronously calls the worker via `fetch("http://localhost:8000/tasks")` during report creation. If the worker is not running, the connection is refused, the report is permanently marked as `FAILED` in the database, and the user gets a 503 error.

## Reproduction Steps

1. Start only the frontend: `cd frontend && npm run dev` (port 3000)
2. Do **NOT** start the Python worker (port 8000)
3. Log in and submit a new report (select any sources, enter an IČO)
4. Observe: immediate error — "Worker is unavailable, report marked as failed"
5. The report is saved to the database with status `FAILED` — it cannot be retried

## Root Cause

### File: `frontend/src/app/api/reports/route.ts` (lines 134–162)

```ts
// Odošleme úlohu workerovi.
try {
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { orsrExtractType: true, crzDateFrom: true },
  });
  await enqueueReportTask({
    reportRequestId: reportRequest.id,
    targetType,
    ico,
    name,
    surname,
    birthDate,
    sources,
    orsrExtractType: dbUser?.orsrExtractType ?? "CURRENT",
    crzDateFrom: dbUser?.crzDateFrom?.toISOString().split("T")[0] ?? null,
  });
} catch (workerErr) {
  console.error("Worker enqueue failed", workerErr);
  await prisma.reportRequest.update({
    where: { id: reportRequest.id },
    data: { status: "FAILED" },
  });

  return NextResponse.json(
    { error: "Worker is unavailable, report marked as failed" },
    { status: 503 }
  );
}
```

The `enqueueReportTask()` call is a synchronous HTTP `fetch` to `http://localhost:8000/tasks`. If the worker process is not running, `fetch` throws a `connection refused` error (or aborts after 8s timeout). The catch block then:

1. **Permanently marks the report as `FAILED`** — no retry mechanism exists.
2. Returns a 503 to the client.

### File: `frontend/src/lib/worker.ts` (lines 18–62)

```ts
const WORKER_URL = process.env.WORKER_URL ?? "http://localhost:8000";

export async function enqueueReportTask(payload: EnqueueTaskPayload) {
  // ...
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
      throw new Error(`Worker (Python) na adrese ${WORKER_URL} neodpovedá (Timeout 8s)...`);
    }
    throw error;  // <-- connection refused lands here, re-thrown to caller
  }
  // ...
}
```

The worker client has an 8-second timeout but no retry logic. Any failure (connection refused, timeout, non-2xx response) is thrown immediately.

### Worker endpoint: `worker/src/main.py` (lines 220–231)

```python
@app.post("/tasks", dependencies=[Depends(verify_worker_secret)])
async def create_task(task: ReportTask, background_tasks: BackgroundTasks):
    background_tasks.add_task(_execute_report, task)
    return {"taskId": task.report_request_id, "status": "accepted"}
```

The worker uses FastAPI `BackgroundTasks` (in-process, not a persistent queue). If the worker is down, tasks are never queued.

## Impact

- **Severity**: High — makes the entire application non-functional for report generation when the worker is not running.
- **Frequency**: Always occurs when only the frontend is started (common during frontend-only development).
- **Data corruption**: Failed reports are persisted in the database with `FAILED` status and cannot be retried — they must be manually deleted.
- **User experience**: The error message is shown but there is no retry button or guidance for the user.

## Expected Behavior

One or more of the following would be appropriate fixes:

1. **Retry mechanism**: When the worker is temporarily unavailable, the report should remain in `PENDING` status and be retried automatically (e.g., with exponential backoff or a job queue).
2. **Queue-based architecture**: Instead of synchronous `fetch`, use a persistent queue (Redis/Celery, or a database-backed queue) so tasks survive worker downtime.
3. **Graceful degradation**: If the worker is down, return a user-friendly error **without** permanently marking the report as `FAILED`. Keep it as `PENDING` so it can be picked up when the worker comes back online.
4. **Health check**: The frontend could check worker health on startup or before submitting and warn the user if the worker is unavailable.

## Environment

- Frontend: Next.js 14.2.4, port 3000
- Worker: FastAPI + Playwright, port 8000
- `WORKER_URL` defaults to `http://localhost:8000` (see `.env.example`)
- No persistent queue (Redis/Celery) — tasks are sent via direct HTTP `fetch`
- Worker uses FastAPI `BackgroundTasks` (in-process, non-persistent)

## Key Files

| File | Role |
|------|------|
| `frontend/src/app/api/reports/route.ts` | POST handler — creates report, calls worker, marks FAILED on error |
| `frontend/src/lib/worker.ts` | Worker HTTP client — `enqueueReportTask()` with 8s timeout, no retry |
| `worker/src/main.py` | FastAPI worker — `/tasks` endpoint, `BackgroundTasks` execution |
| `frontend/.env.example` | Config template — `WORKER_URL="http://localhost:8000"` |
