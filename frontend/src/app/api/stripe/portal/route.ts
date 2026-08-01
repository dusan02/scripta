import { NextRequest, NextResponse } from "next/server";
import { NEXTAUTH_URL } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const baseUrl = NEXTAUTH_URL;

  const res = await fetch(`${baseUrl}/api/billing/portal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  return NextResponse.json(await res.json(), { status: res.status });
}
