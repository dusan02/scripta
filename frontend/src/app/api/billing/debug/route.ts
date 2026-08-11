import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    BILLING_PROVIDER: process.env.BILLING_PROVIDER || "(not set)",
    PADDLE_ENVIRONMENT: process.env.PADDLE_ENVIRONMENT || "(not set)",
    PADDLE_API_KEY: process.env.PADDLE_API_KEY ? "set (" + process.env.PADDLE_API_KEY.substring(0, 20) + "...)" : "❌ missing",
    PADDLE_WEBHOOK_SECRET: process.env.PADDLE_WEBHOOK_SECRET ? "✅ set" : "❌ missing",
    PADDLE_PRICE_1: process.env.PADDLE_PRICE_1 || "❌ missing",
    PADDLE_PRICE_10: process.env.PADDLE_PRICE_10 || "❌ missing",
    PADDLE_PRICE_50: process.env.PADDLE_PRICE_50 || "❌ missing",
  });
}
