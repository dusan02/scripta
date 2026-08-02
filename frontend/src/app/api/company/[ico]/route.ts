import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "@/lib/auth";
import { rateLimitByKey, rateLimitResponse } from "@/lib/rateLimit";

export async function GET(
  request: NextRequest,
  { params }: { params: { ico: string } }
) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Rate limit by user ID (not just IP) — prevents enumeration via IP rotation
    const rl = await rateLimitByKey(`company:${session.user.id}`, { windowMs: 10 * 60 * 1000, maxRequests: 60 });
    if (!rl.allowed) return rateLimitResponse(rl);

    const ico = params.ico;

    // Validate IČO format — must be exactly 8 digits
    if (!ico || !/^\d{8}$/.test(ico)) {
      return NextResponse.json({ error: "Neplatné IČO" }, { status: 400 });
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
