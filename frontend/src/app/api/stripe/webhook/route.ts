import { NextRequest, NextResponse } from "next/server";
import { NEXTAUTH_URL } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const baseUrl = NEXTAUTH_URL;
  const body = await req.text();
  const signature = req.headers.get("stripe-signature") || "";

  const res = await fetch(`${baseUrl}/api/billing/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      "stripe-signature": signature,
    },
    body,
  });

  return NextResponse.json(await res.json(), { status: res.status });
}
