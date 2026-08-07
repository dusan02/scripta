import { NextRequest, NextResponse } from "next/server";
import { SourceType, ReportStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { enqueueReportTask, checkWorkerHealth } from "@/lib/worker";
import { rateLimit, rateLimitResponse } from "@/lib/rateLimit";
import { consumeCreditsTx, refundCredits } from "@/lib/credits";
import { reportRequestSchema } from "./schema";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)));
    const search = searchParams.get("search") ?? "";
    const status = searchParams.get("status") ?? "";
    const sortBy = searchParams.get("sortBy") ?? "createdAt";
    const sortOrder = searchParams.get("sortOrder") ?? "desc";
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const trashed = searchParams.get("trashed") === "true";

    const where: Record<string, unknown> = { userId: user.id };
    if (trashed) {
      where.deletedAt = { not: null };
    } else {
      where.deletedAt = null;
    }
    // Date range filter (replaces hardcoded 30-day cutoff when provided)
    if (dateFrom || dateTo) {
      const dateFilter: Record<string, unknown> = {};
      if (dateFrom) dateFilter.gte = new Date(dateFrom);
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        dateFilter.lte = end;
      }
      where.createdAt = dateFilter;
    } else {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 30);
      where.createdAt = { gte: cutoffDate };
    }
    if (status && status !== "ALL") {
      where.status = status as ReportStatus;
    }
    if (search) {
      where.OR = [
        { ico: { contains: search } },
        { companyName: { contains: search, mode: "insensitive" } },
      ];
    }

    const validSortFields = ["createdAt", "companyName"];
    const sortField = validSortFields.includes(sortBy) ? sortBy : "createdAt";
    const order = sortOrder === "asc" ? "asc" : "desc";

    const [reports, total] = await Promise.all([
      prisma.reportRequest.findMany({
        where,
        orderBy: { [sortField]: order },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          sources: { select: { sourceType: true, status: true } },
        },
      }),
      prisma.reportRequest.count({ where }),
    ]);

    const serialized = reports.map((r) => ({
      id:         r.id,
      status:     r.status,
      targetType: r.targetType,
      ico:        r.ico,
      companyName: r.companyName,
      createdAt:  r.createdAt.toISOString(),
      sources:    r.sources,
    }));

    return NextResponse.json({
      reports: serialized,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("GET /api/reports error", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { windowMs: 10 * 60 * 1000, maxRequests: 20 });
  if (!rl.allowed) return rateLimitResponse(rl);

  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check credits — count only credits from non-expired batches.
    // The wallet balance may be stale if the expiration cron failed to run,
    // so we verify against actual batch expiry dates to prevent spending
    // credits the user no longer has a right to.
    const validBatches = await prisma.creditBatch.aggregate({
      where: {
        userId: user.id,
        remaining: { gt: 0 },
        expiresAt: { gt: new Date() },
      },
      _sum: { remaining: true },
    });
    const availableCredits = validBatches._sum.remaining ?? 0;
    if (availableCredits <= 0) {
      // Distinguish "never had credits" from "credits expired" for a clearer message.
      const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
      const walletBalance = wallet ? Number(wallet.balance) : 0;
      const errorMsg = walletBalance > 0
        ? "Vaše kredity expirovali. Vyberte si nový balíček v cenníku."
        : "Nemáte dostatok kreditov. Vyberte si balíček v cenníku.";
      return NextResponse.json(
        { error: errorMsg },
        { status: 402 }
      );
    }

    const body = await req.json();

    const parseResult = reportRequestSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parseResult.error.flatten() },
        { status: 400 }
      );
    }

    let { ico, sources } = parseResult.data;

    // ── Deduplikácia: ak už beží report pre rovnaké IČO (mladší ako 2 min), vráť existujúci.
    // Chráni pred dvojklikom, refreshom, alebo dvomi tabmi — žiadny kredit sa nemrhá.
    if (ico) {
      const existing = await prisma.reportRequest.findFirst({
        where: {
          userId: user.id,
          ico,
          status: { in: ["PENDING", "PROCESSING"] },
          createdAt: { gt: new Date(Date.now() - 2 * 60 * 1000) },
          deletedAt: null,
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (existing) {
        return NextResponse.json(
          { reportRequestId: existing.id, deduplicated: true },
          { status: 200 }
        );
      }
    }

    // PREFILTRUJ zdroje podľa user settings (defaultSources z DB)
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { defaultSources: true, orsrExtractType: true, crzDateFrom: true, rozhodnutiaDateFrom: true, vestnikDateFrom: true, reportLanguage: true, attachmentsConfig: true },
    });
    if (dbUser?.defaultSources && Array.isArray(dbUser.defaultSources) && dbUser.defaultSources.length > 0) {
      const userSources = dbUser.defaultSources as string[];
      const filteredSources = sources.filter((s) => userSources.includes(s));
      if (filteredSources.length === 0) {
        return NextResponse.json(
          { error: "Nemáte vybrané žiadne zdroje v Nastaveniach." },
          { status: 400 }
        );
      }
      // Použi prefiltrované zdroje
      sources = filteredSources as SourceType[];
    }

    // OVERENIE: Worker je online pred vytvorením DB záznamu
    const isWorkerOnline = await checkWorkerHealth();
    if (!isWorkerOnline) {
      return NextResponse.json(
        { error: "Worker pre extrakciu momentálne nie je spustený alebo neodpovedá. Zapnite ho a skúste znova. Vytváranie reportu bolo zrušené." },
        { status: 503 }
      );
    }

    // Company name sa nastaví workerom po ORSR scrape (správne handling neaktuálnych výpisov)
    const companyName: string | null = null;

    // Atomic transaction: consume credit + create report in one DB transaction.
    // This prevents race conditions where another request could exhaust credits
    // between the check and the consumption, or where report creation succeeds
    // but credit consumption fails (leaving an unpaid report).
    let creditFailReason: "INSUFFICIENT" | "EXPIRED" | "NO_WALLET" | null = null;
    const reportRequest = await prisma.$transaction(async (tx) => {
      // Consume credit first — if this fails, no report is created
      const creditResult = await consumeCreditsTx(tx, user.id, 1);
      if (!creditResult.ok) {
        creditFailReason = creditResult.reason;
        throw new Error("CREDIT_CONSUMPTION_FAILED");
      }

      // Create report in the same transaction
      return tx.reportRequest.create({
        data: {
          userId: user.id,
          targetType: "COMPANY",
          ico: ico ?? null,
          companyName,
          selectedSources: sources as SourceType[],
          status: "PENDING",
          attachmentsConfig: dbUser?.attachmentsConfig as any ?? undefined,
          sources: {
            create: (sources as SourceType[]).map((source) => ({
              sourceType: source,
              status: "PENDING",
            })),
          },
        },
      });
    }).catch((err) => {
      if (err.message === "CREDIT_CONSUMPTION_FAILED") return null;
      throw err;
    });

    if (!reportRequest) {
      // Distinguish "credits expired between check and consume" from "insufficient"
      const errorMsg = creditFailReason === "EXPIRED"
        ? "Vaše kredity expirovali. Vyberte si nový balíček v cenníku."
        : "Nepodarilo sa stiahnuť kredity. Skúste to znova alebo kontaktujte podporu.";
      return NextResponse.json(
        { error: errorMsg },
        { status: 402 }
      );
    }

    // Odošleme úlohu workerovi.
    try {
      await enqueueReportTask({
        reportRequestId: reportRequest.id,
        targetType: "COMPANY",
        ico,
        sources,
        orsrExtractType: dbUser?.orsrExtractType ?? "CURRENT",
        crzDateFrom: dbUser?.crzDateFrom?.toISOString().split("T")[0] ?? null,
        rozhodnutiaDateFrom: dbUser?.rozhodnutiaDateFrom?.toISOString().split("T")[0] ?? null,
        vestnikDateFrom: dbUser?.vestnikDateFrom?.toISOString().split("T")[0] ?? null,
        reportLanguage: dbUser?.reportLanguage ?? "sk",
        attachmentsConfig: dbUser?.attachmentsConfig as Record<string, boolean> | null ?? null,
      });
    } catch (workerErr) {
      console.error("Worker enqueue failed", workerErr);
      
      // If enqueue fails, we must refund the credit
      await refundCredits(user.id, 1, reportRequest.id);

      await prisma.reportRequest.update({
        where: { id: reportRequest.id },
        data: { status: "FAILED" },
      });

      return NextResponse.json(
        { error: "Komunikácia s workerom zlyhala. Report nebol uložený, skúste znova." },
        { status: 503 }
      );
    }

    await prisma.reportRequest.update({
      where: { id: reportRequest.id },
      data: { status: "PROCESSING" },
    });

    revalidatePath("/dashboard");
    revalidatePath("/history");

    return NextResponse.json({ reportRequestId: reportRequest.id }, { status: 201 });
  } catch (error) {
    console.error("POST /api/reports error", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const reportId = searchParams.get("id");
    const deleteAll = searchParams.get("all") === "true";

    if (deleteAll) {
      const result = await prisma.reportRequest.updateMany({
        where: { userId: user.id, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      revalidatePath("/history");
      revalidatePath("/dashboard");
      return NextResponse.json({ deleted: result.count });
    }

    // Bulk delete by IDs
    const ids = searchParams.get("ids");
    if (ids) {
      const idList = ids.split(",").filter(Boolean);
      if (idList.length === 0) {
        return NextResponse.json({ error: "No IDs provided" }, { status: 400 });
      }
      const result = await prisma.reportRequest.updateMany({
        where: { id: { in: idList }, userId: user.id, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      revalidatePath("/history");
      revalidatePath("/dashboard");
      return NextResponse.json({ deleted: result.count });
    }

    if (!reportId) {
      return NextResponse.json({ error: "Report ID is required" }, { status: 400 });
    }

    const report = await prisma.reportRequest.findUnique({
      where: { id: reportId },
    });

    if (!report || report.deletedAt) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    if (report.userId !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await prisma.reportRequest.update({
      where: { id: reportId },
      data: { deletedAt: new Date() },
    });

    revalidatePath("/history");
    revalidatePath("/dashboard");
    return NextResponse.json({ deleted: 1 });
  } catch (error) {
    console.error("DELETE /api/reports error", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
