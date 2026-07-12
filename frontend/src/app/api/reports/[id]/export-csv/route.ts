import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

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
      select: { id: true, userId: true, ico: true, status: true },
    });

    if (!report || !report.ico) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    if (report.userId !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (report.status !== "COMPLETED" && report.status !== "PARTIAL") {
      return NextResponse.json(
        { error: "Report is not ready for export" },
        { status: 422 }
      );
    }

    const company = await prisma.company.findUnique({
      where: { ico: report.ico },
      include: {
        financialStatements: {
          orderBy: { year: "asc" },
          include: { auditorOpinion: true },
        },
      },
    });

    if (!company || !company.financialStatements.length) {
      return NextResponse.json(
        { error: "No financial statements available for export" },
        { status: 404 }
      );
    }

    const stmts = company.financialStatements;

    const fields = [
      "year",
      "monthsInPeriod",
      "mainActivityRevenue",
      "totalRevenue",
      "costOfGoodsSold",
      "grossProfit",
      "operatingExpenses",
      "operatingProfit",
      "financialExpenses",
      "profitBeforeTax",
      "incomeTax",
      "netProfitLoss",
      "totalAssets",
      "nonCurrentAssets",
      "currentAssets",
      "inventory",
      "tradeReceivables",
      "cashAndEquivalents",
      "equity",
      "shareCapital",
      "retainedEarnings",
      "totalLiabilities",
      "shortTermLiabilities",
      "longTermLiabilities",
      "tradePayables",
      "bankLoans",
      "operatingCashFlow",
      "investingCashFlow",
      "financingCashFlow",
      "altmanZScore",
      "piotroskiScore",
    ];

    const header = ["Metric", ...stmts.map((s) => String(s.year))].join(",");
    const rows = fields.map((field) => {
      const values = stmts.map((s) => {
        const val = (s as Record<string, unknown>)[field];
        return escapeCsv(val);
      });
      return [field, ...values].join(",");
    });

    // Add auditor opinion row
    const auditorRow = [
      "auditor_opinion",
      ...stmts.map((s) =>
        escapeCsv(s.auditorOpinion?.opinionType ?? "")
      ),
    ].join(",");
    rows.push(auditorRow);

    const csv = [header, ...rows].join("\n");

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="financials-${report.ico}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("GET /api/reports/[id]/export-csv error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
