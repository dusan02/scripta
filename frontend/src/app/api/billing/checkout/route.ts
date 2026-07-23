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

    const { planId } = await req.json();
    if (!planId) {
      return NextResponse.json({ error: "Plan ID required" }, { status: 400 });
    }

    const adapter = getBillingAdapter();
    const result = await adapter.createCheckoutSession({
      planId,
      userId: session.user.id,
      userEmail: session.user.email,
    });

    return NextResponse.json({ url: result.url });
  } catch {
    return NextResponse.json({ error: "Checkout failed" }, { status: 500 });
  }
}
