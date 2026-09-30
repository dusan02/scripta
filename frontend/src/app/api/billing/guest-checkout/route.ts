import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { PADDLE_PRICE_MAP } from "@/lib/billing/paddle";
import { rateLimit, rateLimitResponse, rateLimitByKey } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// Guest checkout is intentionally limited to one-time report bundles —
// subscriptions require an account before checkout.
const GUEST_PLANS = new Set(["payg1", "payg10", "payg50"]);

const guestCheckoutSchema = z.object({
  ico: z.string().regex(/^\d{8}$/, "IČO musí obsahovať presne 8 číslic"),
  email: z.string().email("Neplatný e-mail").max(254),
  planId: z.string(),
});

/**
 * POST /api/billing/guest-checkout — start a Paddle checkout WITHOUT an
 * account. The visitor provides IČO + email; payment fulfillment (account
 * creation, credit grant, report enqueue) happens exclusively in the
 * verified Paddle webhook via the GuestCheckout record created here.
 *
 * Abuse surface: record creation is rate-limited per IP and per email, the
 * IČO must exist in the company database, and nothing is granted until a
 * signed transaction.completed webhook arrives.
 */
export async function POST(req: NextRequest) {
  // Strict IP rate limit — public endpoint, protects Paddle API + DB writes.
  const rlIp = await rateLimit(req, { windowMs: 10 * 60 * 1000, maxRequests: 5 });
  if (!rlIp.allowed) return rateLimitResponse(rlIp);

  try {
    const body = await req.json().catch(() => null);
    const parsed = guestCheckoutSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { ico, planId } = parsed.data;
    const email = parsed.data.email.toLowerCase().trim();

    if (!GUEST_PLANS.has(planId)) {
      return NextResponse.json({ error: "Invalid plan ID" }, { status: 400 });
    }

    const plan = PADDLE_PRICE_MAP[planId];
    if (!plan || !plan.priceId) {
      return NextResponse.json({ error: "Plan is not available" }, { status: 400 });
    }

    // Per-email limit — prevents using this endpoint to spam accounts/emails.
    const rlEmail = await rateLimitByKey(`guest-checkout:${email}`, {
      windowMs: 60 * 60 * 1000,
      maxRequests: 5,
    });
    if (!rlEmail.allowed) return rateLimitResponse(rlEmail);

    // The company must exist — catches typos and prevents paying for a
    // report the worker could never produce.
    const company = await prisma.company.findUnique({
      where: { ico },
      select: { ico: true, name: true },
    });
    if (!company) {
      return NextResponse.json(
        { error: "Firma s týmto IČO nebola nájdená v databáze." },
        { status: 404 }
      );
    }

    // Reuse an existing pending checkout for the same email+ico+plan —
    // avoids record spam when the user retries.
    const now = new Date();
    let checkout = await prisma.guestCheckout.findFirst({
      where: { email, ico, planId, status: "PENDING", expiresAt: { gt: now } },
      orderBy: { createdAt: "desc" },
    });
    if (!checkout) {
      checkout = await prisma.guestCheckout.create({
        data: {
          ico,
          email,
          planId,
          companyName: company.name,
          expiresAt: new Date(now.getTime() + 30 * 60 * 1000), // 30 min to pay
        },
      });
    }

    const response = NextResponse.json({
      url: `/credits/checkout?planId=${encodeURIComponent(planId)}&guest=1`,
    });
    // Opaque reference only — the authoritative data (ico, email, plan) lives
    // server-side in the GuestCheckout row, so cookie tampering is harmless.
    response.cookies.set("guest_ctx", JSON.stringify({ guestId: checkout.id }), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 60,
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("[guest-checkout] error:", error);
    return NextResponse.json({ error: "Checkout failed" }, { status: 500 });
  }
}
