import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { PLAN_CREDITS_MAP } from "@/lib/billing/paddle";
import { rateLimitByKey, rateLimitResponse } from "@/lib/rateLimit";
import { confirmSchema } from "@/lib/api-schemas";

export const dynamic = "force-dynamic";

/**
 * Confirm route — verifies a Paddle transaction completed successfully.
 *
 * This route does NOT grant credits. Credits are granted exclusively by the
 * webhook handler (/api/billing/webhook) which is the source of truth.
 * This route only verifies the transaction status so the frontend can show
 * a success message immediately (without waiting for the webhook).
 *
 * Previously, this route also called addCreditBatch() — but that created a
 * double-spend race condition when the webhook and confirm arrived
 * concurrently. The idempotency check used different eventId values
 * ("confirm-{txnId}" vs Paddle's event_id), so both could succeed.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rl = await rateLimitByKey(`confirm:${session.user.id}`, {
      windowMs: 10 * 60 * 1000,
      maxRequests: 20,
    });
    if (!rl.allowed) return rateLimitResponse(rl);

    const body = await req.json().catch(() => null);
    const parsed = confirmSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Transaction ID required", details: parsed.error.flatten() }, { status: 400 });
    }
    const { transactionId } = parsed.data;

    const apiKey = process.env.PADDLE_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Paddle not configured" }, { status: 500 });
    }

    const baseUrl = process.env.PADDLE_ENVIRONMENT === "production"
      ? "https://api.paddle.com"
      : "https://sandbox-api.paddle.com";

    const res = await fetch(`${baseUrl}/transactions/${transactionId}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      console.error("[confirm] Paddle API error:", res.status, await res.text());
      return NextResponse.json({ error: "Failed to verify transaction" }, { status: 502 });
    }

    const txn = (await res.json()).data;
    if (txn.status !== "completed") {
      return NextResponse.json({ error: "Transaction not completed", status: txn.status }, { status: 400 });
    }

    const customData = txn.custom_data || {};
    const planId = customData.planId;
    const userId = customData.userId;

    if (!planId || !userId) {
      return NextResponse.json({ error: "Missing custom data" }, { status: 400 });
    }

    if (userId !== session.user.id) {
      return NextResponse.json({ error: "Transaction does not belong to user" }, { status: 403 });
    }

    const credits = PLAN_CREDITS_MAP[planId];
    if (!credits || credits <= 0) {
      return NextResponse.json({ error: "Unknown plan" }, { status: 400 });
    }

    // Only verify — credits are granted by the webhook handler.
    return NextResponse.json({ ok: true, credits, verified: true });
  } catch (error) {
    console.error("[confirm] Error:", error);
    return NextResponse.json({ error: "Confirmation failed" }, { status: 500 });
  }
}
