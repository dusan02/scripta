import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Internal endpoint for middleware slug validation.
 * Returns { ico, name, slug } for a given ICO.
 * No auth — protected by x-middleware-internal header check.
 * Not matched by middleware (excluded via matcher).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { ico: string } }
) {
  // Only allow internal calls from middleware
  const internalHeader = request.headers.get("x-middleware-internal");
  if (internalHeader !== "1") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ico = params.ico;
  if (!ico || !/^\d{8,10}$/.test(ico)) {
    return NextResponse.json({ error: "Invalid IČO" }, { status: 400 });
  }

  const company = await prisma.company.findUnique({
    where: { ico },
    select: { ico: true, name: true },
  });

  if (!company) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(company);
}
