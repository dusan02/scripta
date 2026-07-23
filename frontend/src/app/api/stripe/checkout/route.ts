import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const body = await req.text();

  const res = await fetch(`${baseUrl}/api/billing/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  return NextResponse.json(await res.json(), { status: res.status });
}
