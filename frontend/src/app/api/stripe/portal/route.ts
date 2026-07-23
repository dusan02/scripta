import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

  const res = await fetch(`${baseUrl}/api/billing/portal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  return NextResponse.json(await res.json(), { status: res.status });
}
