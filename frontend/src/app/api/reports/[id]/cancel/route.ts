import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { refundCredits } from "@/lib/credits";

export const dynamic = "force-dynamic";

const WORKER_URL = process.env.WORKER_URL ?? "http://localhost:8000";
const WORKER_SECRET = process.env.WORKER_SECRET;
const CANCEL_WINDOW_SECONDS = 8;

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const report = await prisma.reportRequest.findUnique({
      where: { id: params.id },
    });

    if (!report) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    if (report.userId !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (["COMPLETED", "PARTIAL", "FAILED", "CANCELLED"].includes(report.status)) {
      return NextResponse.json(
        { error: "Report už je dokončený alebo zrušený." },
        { status: 422 }
      );
    }

    // Check cancel window (first N seconds from creation)
    const elapsed = (Date.now() - report.createdAt.getTime()) / 1000;
    if (elapsed > CANCEL_WINDOW_SECONDS) {
      return NextResponse.json(
        { error: `Storno je možné len v prvých ${CANCEL_WINDOW_SECONDS} sekundách.` },
        { status: 422 }
      );
    }

    // 1. Abort arq job on worker
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (WORKER_SECRET) headers["x-worker-secret"] = WORKER_SECRET;
      await fetch(`${WORKER_URL}/tasks/${params.id}/cancel`, {
        method: "POST",
        headers,
        signal: AbortSignal.timeout(5000),
      });
    } catch (e) {
      console.error("Worker cancel request failed", e);
    }

    // 2. Update report status to CANCELLED
    await prisma.reportRequest.update({
      where: { id: params.id },
      data: { status: "CANCELLED", completedAt: new Date() },
    });

    // 3. Refund credit
    await refundCredits(user.id, 1, params.id);

    return NextResponse.json({ status: "cancelled" });
  } catch (error) {
    console.error("POST /api/reports/[id]/cancel error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
