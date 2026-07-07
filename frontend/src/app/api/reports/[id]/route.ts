import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

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

    console.log("DEBUG API route report.aiStatus:", report.aiStatus);

    // Verifa skóre: preferujeme snapshot uložený priamo na reporte (fixované v čase generovania).
    // Fallback na AuditVerdict len pre staré reporty pred migráciou (report.verifaScore === null).
    let verifaScore = 100;
    if (report.verifaScore !== null && report.verifaScore !== undefined) {
      verifaScore = report.verifaScore;
    } else if (report.ico) {
      const verdict = await prisma.auditVerdict.findUnique({
        where: { companyIco: report.ico }
      });
      if (verdict) {
        verifaScore = verdict.verifaScore;
      }
    }

    let resolvedCompanyName = report.companyName;
    if (!resolvedCompanyName && report.ico) {
      const company = await prisma.company.findUnique({
        where: { ico: report.ico },
        select: { name: true }
      });
      if (company?.name) {
        resolvedCompanyName = company.name;
      }
    }

    return NextResponse.json({
      id: report.id,
      status: report.status,
      targetType: report.targetType,
      ico: report.ico,
      companyName: resolvedCompanyName,
      selectedSources: report.selectedSources,
      createdAt: report.createdAt,
      completedAt: report.completedAt,
      resultUrl: report.resultUrl,
      aiStatus: report.aiStatus,
      eta: report.eta,
      verifaScore: verifaScore,
      sources: report.sources.map((s) => ({
        id: s.id,
        sourceType: s.sourceType,
        status: s.status,
        statusMessage: s.statusMessage,
        pageCount: s.pageCount,
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
