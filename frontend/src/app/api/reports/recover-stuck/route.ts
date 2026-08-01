import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { refundCredits } from "@/lib/credits";
import { verifyCronSecret } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Cron job to recover stuck "PROCESSING" reports.
 *
 * If the Python worker crashes (OOM, SIGKILL, container restart) while
 * processing a report, the report stays in "PROCESSING" forever and the
 * user's credit is never refunded. This endpoint finds reports stuck in
 * PROCESSING for longer than STUCK_THRESHOLD_MINUTES, marks them as FAILED,
 * and refunds the credit.
 *
 * It also handles the case where the worker's fire-and-forget refund request
 * to /api/reports/{id}/refund failed (e.g. Vercel cold start, network issue) —
 * any FAILED report without an existing REFUND transaction will be refunded here.
 *
 * Schedule: every 15 minutes via external cron (e.g. Vercel Cron, Upstash QStash).
 * Auth: Bearer CRON_SECRET header (timing-safe comparison).
 */
export async function POST(req: Request) {
  if (!verifyCronSecret(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const STUCK_THRESHOLD_MINUTES = 20;
  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MINUTES * 60 * 1000);

  try {
    // 1. Find reports stuck in PROCESSING for longer than the threshold.
    //    Exclude soft-deleted reports — they were removed by the user and
    //    should not be recovered or refunded.
    const stuckReports = await prisma.reportRequest.findMany({
      where: {
        status: "PROCESSING",
        createdAt: { lt: cutoff },
        deletedAt: null,
      },
      select: { id: true, userId: true },
    });

    let stuckRecovered = 0;
    for (const report of stuckReports) {
      await prisma.reportRequest.update({
        where: { id: report.id },
        data: { status: "FAILED", completedAt: new Date() },
      });
      try {
        await refundCredits(report.userId, 1, report.id);
        stuckRecovered++;
      } catch (refundErr) {
        console.error(`[recover-stuck] Refund failed for report ${report.id}:`, refundErr);
      }
    }

    // 2. Find FAILED reports that were never refunded (worker's fire-and-forget
    //    refund request may have failed due to network/cold-start issues).
    //    We look for FAILED reports with a CHARGE transaction but no REFUND.
    //    Limit to recent reports (last 24h) to avoid scanning the entire table
    //    on every cron run — older FAILED reports have already been processed
    //    by previous runs.
    const failedCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const failedReports = await prisma.reportRequest.findMany({
      where: {
        status: "FAILED",
        deletedAt: null,
        createdAt: { gte: failedCutoff },
      },
      select: { id: true, userId: true },
      take: 100,
    });

    let missedRefundsProcessed = 0;
    for (const report of failedReports) {
      // Check if a REFUND transaction already exists for this report.
      const existingRefund = await prisma.walletTransaction.findFirst({
        where: { type: "REFUND", reportRequestId: report.id },
      });
      if (existingRefund) continue;

      // Check that a CHARGE exists (credit was actually deducted).
      const existingCharge = await prisma.walletTransaction.findFirst({
        where: { type: "CHARGE", reportRequestId: report.id },
      });
      if (!existingCharge) continue;

      try {
        await refundCredits(report.userId, 1, report.id);
        missedRefundsProcessed++;
      } catch (refundErr) {
        console.error(`[recover-stuck] Missed refund failed for report ${report.id}:`, refundErr);
      }
    }

    const totalRecovered = stuckRecovered + missedRefundsProcessed;
    if (totalRecovered > 0) {
      console.log(
        `[recover-stuck] Recovered ${stuckRecovered} stuck PROCESSING reports, ` +
        `processed ${missedRefundsProcessed} missed refunds.`
      );
    }

    return NextResponse.json({
      stuckRecovered,
      missedRefundsProcessed,
      stuckReportsFound: stuckReports.length,
    });
  } catch (error) {
    console.error("Recover-stuck cron error:", error);
    return NextResponse.json(
      { error: "Cron failed", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
