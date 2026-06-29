import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: { ico: string } }
) {
  try {
    const ico = params.ico;

    if (!ico) {
      return NextResponse.json({ error: "IČO is required" }, { status: 400 });
    }

    // Načítame firmu so všetkými finančnými výkazmi a názormi audítora
    const company = await prisma.company.findUnique({
      where: { ico },
      include: {
        financialStatements: {
          orderBy: { year: "desc" },
          include: {
            auditorOpinion: true,
          },
        },
      },
    });

    if (!company) {
      return NextResponse.json(
        { error: "Company not found in the database." },
        { status: 404 }
      );
    }

    return NextResponse.json({ data: company });
  } catch (error: any) {
    console.error("API Error fetching company financials:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
