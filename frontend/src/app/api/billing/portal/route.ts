import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { getBillingAdapter } from "@/lib/billing";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const adapter = getBillingAdapter();
    const result = await adapter.createPortalSession(session.user.email);
    return NextResponse.json({ url: result.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create portal session";
    const status = message.includes("No active subscription") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
