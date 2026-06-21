import { NextRequest, NextResponse } from "next/server";
import { Prisma, SourceType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { enqueueReportTask } from "@/lib/worker";
import { calculateCost, reportRequestSchema, SOURCE_COSTS } from "./schema";

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const parseResult = reportRequestSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parseResult.error.flatten() },
        { status: 400 }
      );
    }

    const { targetType, ico, name, surname, birthDate, sources } = parseResult.data;

    // Validácia: pre firmu IČO, pre osobu meno + priezvisko + dátum narodenia.
    if (targetType === "COMPANY" && !ico) {
      return NextResponse.json(
        { error: "IČO is required for company target" },
        { status: 400 }
      );
    }
    if (targetType === "PERSON" && (!name || !surname || !birthDate)) {
      return NextResponse.json(
        { error: "Name, surname and birth date are required for person target" },
        { status: 400 }
      );
    }

    const totalCost = calculateCost(sources);

    const wallet = await prisma.wallet.findUnique({
      where: { userId: user.id },
    });

    if (!wallet || wallet.balance.toNumber() < totalCost) {
      return NextResponse.json(
        { error: "Insufficient credits", required: totalCost, balance: wallet?.balance.toNumber() ?? 0 },
        { status: 402 }
      );
    }

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Optimistic locking: kontrolujeme version, strhávame kredit.
      const updatedWallet = await tx.wallet.updateMany({
        where: { id: wallet.id, version: wallet.version },
        data: {
          balance: { decrement: totalCost },
          version: { increment: 1 },
        },
      });

      if (updatedWallet.count === 0) {
        throw new Error("Concurrent wallet update conflict");
      }

      const reportRequest = await tx.reportRequest.create({
        data: {
          userId: user.id,
          targetType,
          ico: ico ?? null,
          name: name ?? null,
          surname: surname ?? null,
          birthDate: birthDate ? new Date(birthDate) : null,
          selectedSources: sources,
          totalCost: totalCost,
          status: "PENDING",
          sources: {
            create: sources.map((source: SourceType) => ({
              sourceType: source,
              status: "PENDING",
              costCredits: SOURCE_COSTS[source] ?? 0,
            })),
          },
        },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          amount: -totalCost,
          type: "CHARGE",
          status: "COMPLETED",
          reportRequestId: reportRequest.id,
          description: `Report ${reportRequest.id} charge`,
        },
      });

      return reportRequest;
    });

    // Odošleme úlohu workerovi mimo transakcie, aby sme neblokovali DB.
    try {
      await enqueueReportTask({
        reportRequestId: result.id,
        targetType,
        ico,
        name,
        surname,
        birthDate,
        sources,
      });
    } catch (workerErr) {
      // Worker nie je dostupný — report označíme ako FAILED a vrátime strhnuté kredity,
      // aby používateľ neprišiel o platené registre (napr. CRE).
      console.error("Worker enqueue failed", workerErr);
      try {
        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          await tx.reportRequest.update({
            where: { id: result.id },
            data: { status: "FAILED" },
          });

          if (totalCost > 0) {
            await tx.wallet.update({
              where: { id: wallet.id },
              data: {
                balance: { increment: totalCost },
                version: { increment: 1 },
              },
            });

            await tx.walletTransaction.create({
              data: {
                walletId: wallet.id,
                amount: totalCost,
                type: "REFUND",
                status: "COMPLETED",
                reportRequestId: result.id,
                description: `Refund for failed report ${result.id} (worker unavailable)`,
              },
            });
          }
        });
      } catch (refundErr) {
        console.error("Refund after worker failure failed", refundErr);
      }

      return NextResponse.json(
        { error: "Worker is unavailable, report marked as failed and credits refunded" },
        { status: 503 }
      );
    }

    await prisma.reportRequest.update({
      where: { id: result.id },
      data: { status: "PROCESSING" },
    });

    return NextResponse.json({ reportRequestId: result.id }, { status: 201 });
  } catch (error) {
    console.error("POST /api/reports error", error);
    return NextResponse.json(
      { error: "Internal server error", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
