import { NextRequest, NextResponse } from "next/server";
import { SourceType, ReportStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { enqueueReportTask } from "@/lib/worker";
import { rateLimit, rateLimitResponse } from "@/lib/rateLimit";
import { reportRequestSchema } from "./schema";

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

    const where: Record<string, unknown> = { userId: user.id };
    if (status && status !== "ALL") {
      where.status = status as ReportStatus;
    }
    if (search) {
      where.OR = [
        { ico: { contains: search } },
        { companyName: { contains: search, mode: "insensitive" } },
        { name: { contains: search, mode: "insensitive" } },
        { surname: { contains: search, mode: "insensitive" } },
      ];
    }

    const [reports, total] = await Promise.all([
      prisma.reportRequest.findMany({
        where,
        orderBy: { createdAt: "desc" },
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
      name:       r.name,
      surname:    r.surname,
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
      { error: "Internal server error", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const rl = rateLimit(req, { windowMs: 10 * 60 * 1000, maxRequests: 20 });
  if (!rl.allowed) return rateLimitResponse(rl);

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

    const reportRequest = await prisma.reportRequest.create({
      data: {
        userId: user.id,
        targetType,
        ico: ico ?? null,
        name: name ?? null,
        surname: surname ?? null,
        birthDate: birthDate ? new Date(birthDate) : null,
        selectedSources: sources as SourceType[],
        totalCost: 0,
        status: "PENDING",
        sources: {
          create: (sources as SourceType[]).map((source) => ({
            sourceType: source,
            status: "PENDING",
            costCredits: 0,
          })),
        },
      },
    });

    // Odošleme úlohu workerovi.
    try {
      const dbUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: { orsrExtractType: true },
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

    await prisma.reportRequest.update({
      where: { id: reportRequest.id },
      data: { status: "PROCESSING" },
    });

    return NextResponse.json({ reportRequestId: reportRequest.id }, { status: 201 });
  } catch (error) {
    console.error("POST /api/reports error", error);
    return NextResponse.json(
      { error: "Internal server error", details: error instanceof Error ? error.message : String(error) },
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
      const result = await prisma.reportRequest.deleteMany({
        where: { userId: user.id },
      });
      return NextResponse.json({ deleted: result.count });
    }

    if (!reportId) {
      return NextResponse.json({ error: "Report ID is required" }, { status: 400 });
    }

    const report = await prisma.reportRequest.findUnique({
      where: { id: reportId },
    });

    if (!report) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    if (report.userId !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await prisma.reportRequest.delete({
      where: { id: reportId },
    });

    return NextResponse.json({ deleted: 1 });
  } catch (error) {
    console.error("DELETE /api/reports error", error);
    return NextResponse.json(
      { error: "Internal server error", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
