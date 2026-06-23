import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export async function GET(
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
      include: { sources: true },
    });

    if (!report) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    if (report.userId !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json({
      id: report.id,
      status: report.status,
      targetType: report.targetType,
      ico: report.ico,
      companyName: report.companyName,
      name: report.name,
      surname: report.surname,
      totalCost: report.totalCost,
      createdAt: report.createdAt,
      completedAt: report.completedAt,
      resultUrl: report.resultUrl,
      sources: report.sources.map((s) => ({
        id: s.id,
        sourceType: s.sourceType,
        status: s.status,
        statusMessage: s.statusMessage,
        pageCount: s.pageCount,
        costCredits: s.costCredits,
        findings: s.findings,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
    });
  } catch (error) {
    console.error("GET /api/reports/[id] error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
