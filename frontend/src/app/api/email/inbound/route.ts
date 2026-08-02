import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Webhook } from "svix";
import { translate, normalizeLang } from "@/lib/i18n";

// Resend Inbound webhook — receives email.received events
// When admin replies to a user message from their email client,
// the reply goes to reply+{userId}@inbound.verifa.sk
// Resend forwards it here, we parse the `to` field to extract userId,
// fetch the full email body via Resend API, and create a REPLY message.

interface InboundEvent {
  type: string;
  created_at: string;
  data: {
    email_id: string;
    from: string;
    to: string[];
    subject: string;
  };
}

interface ReceivedEmail {
  id: string;
  from: string;
    to: string[];
  subject: string;
  text?: string;
  html?: string;
  headers?: {
    from?: string;
    to?: string;
    subject?: string;
  };
}

export async function POST(req: NextRequest) {
  try {
    // Verify Resend webhook signature using Svix.
    // The raw body must be used — parsing as JSON and re-stringifying
    // would break the cryptographic signature.
    const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error("[inbound] RESEND_WEBHOOK_SECRET not configured — rejecting all webhooks");
      return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
    }

    const payload = await req.text();
    const svixHeaders: Record<string, string> = {};
    const svixId = req.headers.get("svix-id");
    const svixTimestamp = req.headers.get("svix-timestamp");
    const svixSignature = req.headers.get("svix-signature");
    if (svixId) svixHeaders["svix-id"] = svixId;
    if (svixTimestamp) svixHeaders["svix-timestamp"] = svixTimestamp;
    if (svixSignature) svixHeaders["svix-signature"] = svixSignature;

    if (!svixId || !svixTimestamp || !svixSignature) {
      console.warn("[inbound] Missing Svix headers — rejecting unauthenticated webhook");
      return NextResponse.json({ error: "Missing signature headers" }, { status: 401 });
    }

    const wh = new Webhook(webhookSecret);
    let event: InboundEvent;
    try {
      event = wh.verify(payload, svixHeaders) as InboundEvent;
    } catch (verifyErr) {
      console.warn("[inbound] Webhook signature verification failed:", verifyErr);
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    if (event.type !== "email.received") {
      return NextResponse.json({ ok: true });
    }

    const { email_id, to, from, subject } = event.data;

    // Find the reply+{userId} address among recipients
    const replyAddress = to.find(addr => addr.startsWith("reply+"));
    if (!replyAddress) {
      return NextResponse.json({ ok: true, skipped: "no reply address" });
    }

    // Extract userId from reply+{userId}@domain
    const match = replyAddress.match(/^reply\+(.+)@/);
    if (!match) {
      return NextResponse.json({ ok: true, skipped: "invalid reply format" });
    }

    const userId = match[1];

    // Verify user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, reportLanguage: true },
    });

    if (!user) {
      console.error("[inbound] User not found for reply address:", replyAddress);
      return NextResponse.json({ ok: true, skipped: "user not found" });
    }

    // Fetch full email content from Resend API
    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) {
      console.error("[inbound] RESEND_API_KEY not configured");
      return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
    }

    const emailRes = await fetch(`https://api.resend.com/emails/receiving/${email_id}`, {
      headers: { Authorization: `Bearer ${resendApiKey}` },
    });

    if (!emailRes.ok) {
      const errText = await emailRes.text();
      console.error("[inbound] Failed to fetch email from Resend:", emailRes.status, errText);
      return NextResponse.json({ error: "Failed to fetch email" }, { status: 502 });
    }

    const emailData: ReceivedEmail = await emailRes.json();

    // Extract reply text — prefer plain text, fallback to HTML stripped
    let body = emailData.text || "";
    if (!body && emailData.html) {
      body = emailData.html.replace(/<[^>]*>/g, "").trim();
    }

    // Strip quoted reply content (everything after common reply markers)
    const replyMarkers = [
      /^On .* wrote:/m,
      /^-----Original Message-----/m,
      /^From: .*/m,
      /^Dňa .* napísal/m,
      /^Dňa .* napísala/m,
      /^Dňa .* wrote:/m,
      /^>/m,
    ];
    for (const marker of replyMarkers) {
      const matchIdx = body.search(marker);
      if (matchIdx > 0) {
        body = body.slice(0, matchIdx).trim();
        break;
      }
    }

    if (!body.trim()) {
      const lang = normalizeLang(user.reportLanguage);
      body = translate(lang, "email.inboundPrazdnaOdpoved");
    }

    // Clean subject — remove Re:/Fwd: prefixes and [Verifa.sk] prefix
    const lang = normalizeLang(user.reportLanguage);
    const cleanSubject = subject
      .replace(/^(Re|Fwd|Aw):\s*/gi, "")
      .replace(/^\[Verifa\.sk\]\s*/i, "")
      .trim() || translate(lang, "email.inboundOdpoved");

    // Create REPLY message in user's inbox
    await prisma.userMessage.create({
      data: {
        type: "REPLY",
        userId: user.id,
        title: cleanSubject.slice(0, 200),
        body: body.slice(0, 5000),
        read: false,
      },
    });

    console.log(`[inbound] Reply delivered to user ${user.email} from ${from}`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[inbound] Error processing webhook:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
