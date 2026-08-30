import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { sendEmail, getReplyToAddress } from "@/lib/email";
import { escapeHtml } from "@/lib/sanitize";
import { messageCreateSchema, messageMarkReadSchema } from "@/lib/api-schemas";
import { rateLimitByKey, rateLimitResponse } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    const rateLimitKey = user ? `messages:${user.id}` : `messages:ip:${req.headers.get("x-forwarded-for") || "unknown"}`;
    const rl = await rateLimitByKey(rateLimitKey, { windowMs: 60 * 1000, maxRequests: 30 });
    if (!rl.allowed) return rateLimitResponse(rl);

    // Správy pre všetkých (userId = null) + správy pre konkrétneho používateľa
    // USER-type messages are outgoing (sent BY user), not shown in inbox
    // Filter out soft-deleted messages
    const where = user
      ? { AND: [
          { OR: [{ userId: null }, { userId: user.id }] },
          { NOT: { type: "USER" as const } },
          { deletedAt: null },
        ]}
      : { AND: [{ userId: null }, { NOT: { type: "USER" as const } }, { deletedAt: null }] };

    const messages = await prisma.userMessage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return NextResponse.json(
      { messages },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
    );
  } catch (error) {
    console.error("GET /api/messages error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const parsed = messageCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Title and message are required", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { title, message } = parsed.data;

    // Rate limiting: max 5 messages per hour per user
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentCount = await prisma.userMessage.count({
      where: {
        type: "USER",
        senderId: user.id,
        createdAt: { gte: oneHourAgo },
      },
    });

    if (recentCount >= 5) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Max 5 messages per hour." },
        { status: 429 }
      );
    }

    // Uložiť správu od používateľa
    const msg = await prisma.userMessage.create({
      data: {
        type: "USER",
        senderId: user.id,
        title: title.trim().slice(0, 200),
        body: message.trim().slice(0, 5000),
      },
    });

    // Poslať e-mail na info@verifa.sk s reply-to obsahujúcim userId používateľa
    try {
      await sendEmail({
        to: "info@verifa.sk",
        replyTo: getReplyToAddress(user.id),
        subject: `[Verifa.sk] ${title.trim()}`,
        text: `Od: ${user.email}\n\n${message.trim()}`,
        html: `<p><strong>Od:</strong> ${escapeHtml(user.email)}</p><p><strong>Predmet:</strong> ${escapeHtml(title.trim())}</p><hr><p style="white-space: pre-wrap;">${escapeHtml(message.trim())}</p>`,
      });
    } catch (emailErr) {
      console.error("Failed to send notification email", emailErr);
    }

    return NextResponse.json({ ok: true, id: msg.id });
  } catch (error) {
    console.error("POST /api/messages error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const parsed = messageMarkReadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "messageIds must be a non-empty array of strings", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { messageIds } = parsed.data;

    // Označiť správy ako prečítané (len pre prihláseného používateľa, nie soft-deleted)
    await prisma.userMessage.updateMany({
      where: {
        id: { in: messageIds },
        OR: [{ userId: null }, { userId: user.id }],
        deletedAt: null,
      },
      data: { read: true },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("PATCH /api/messages error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const messageId = url.searchParams.get("id");

    if (!messageId) {
      return NextResponse.json({ error: "Message ID required" }, { status: 400 });
    }

    // Soft-delete — len správy patriace používateľovi alebo broadcast
    const result = await prisma.userMessage.updateMany({
      where: {
        id: messageId,
        OR: [{ userId: user.id }, { userId: null }],
        deletedAt: null,
      },
      data: { deletedAt: new Date() },
    });

    if (result.count === 0) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("DELETE /api/messages error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
