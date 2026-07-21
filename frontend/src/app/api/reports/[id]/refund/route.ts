import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { refundCredits } from "@/lib/credits";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: reportId } = await params;

  const authHeader = req.headers.get("x-worker-secret");
  if (authHeader !== process.env.WORKER_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const report = await prisma.reportRequest.findUnique({
      where: { id: reportId },
      select: { userId: true, status: true },
    });

    if (!report) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    if (report.status !== "FAILED") {
      return NextResponse.json({ error: "Not eligible for refund" }, { status: 422 });
    }

    await refundCredits(report.userId, 1, reportId);

    return NextResponse.json({ refunded: true });
  } catch (error) {
    console.error("Refund error:", error);
    return NextResponse.json({ error: "Refund failed" }, { status: 500 });
  }
}
