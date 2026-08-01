import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Webhook } from "svix";

export const dynamic = "force-dynamic";

type EmailEvent = {
  type: string;
  created_at: string;
  email: {
    email: string;
    from: string;
    subject?: string;
  };
  bounce?: {
    type?: string;
    subType?: string;
    message?: string;
    smtpResponse?: string;
  };
  complaint?: {
    type?: string;
    message?: string;
  };
};

export async function POST(req: NextRequest) {
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[email/events] RESEND_WEBHOOK_SECRET not configured");
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  const payload = await req.text();
  const svixHeaders: Record<string, string> = {};
  const svixId = req.headers.get("svix-id");
  const svixTimestamp = req.headers.get("svix-timestamp");
  const svixSignature = req.headers.get("svix-signature");
  if (svixId) svixHeaders["svix-id"] = svixId;
  if (svixTimestamp) svixHeaders["svix-timestamp"] = svixTimestamp;
  if (svixSignature) svixHeaders["svix-signature"] = svixSignature;

  let event: EmailEvent;
  try {
    const wh = new Webhook(webhookSecret);
    event = wh.verify(payload, svixHeaders) as EmailEvent;
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Only handle bounce and complaint events
  if (event.type !== "email.bounced" && event.type !== "email.complained") {
    return NextResponse.json({ ok: true });
  }

  const emailAddress = event.email?.email?.toLowerCase().trim();
  if (!emailAddress) {
    return NextResponse.json({ ok: true });
  }

  try {
    if (event.type === "email.bounced") {
      const reason = event.bounce?.message || event.bounce?.smtpResponse || "Unknown bounce";
      await prisma.user.updateMany({
        where: { email: emailAddress },
        data: {
          emailBounced: true,
          emailBouncedAt: new Date(),
          emailBouncedReason: reason,
        },
      });
      console.warn(`[email/events] Bounce recorded for ${emailAddress}: ${reason}`);
    } else if (event.type === "email.complained") {
      await prisma.user.updateMany({
        where: { email: emailAddress },
        data: {
          emailComplained: true,
          emailComplainedAt: new Date(),
        },
      });
      console.warn(`[email/events] Complaint recorded for ${emailAddress}`);
    }
  } catch (err) {
    console.error("[email/events] DB error:", err);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
