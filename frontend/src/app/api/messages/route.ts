import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { sendEmail } from "@/lib/email";

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);

    // Správy pre všetkých (userId = null) + správy pre konkrétneho používateľa
    // USER-type messages are outgoing (sent BY user), not shown in inbox
    const where = user
      ? { AND: [
          { OR: [{ userId: null }, { userId: user.id }] },
          { NOT: { type: "USER" as const } },
        ]}
      : { AND: [{ userId: null }, { NOT: { type: "USER" as const } }] };

    const messages = await prisma.userMessage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return NextResponse.json({ messages });
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

    const body = await req.json();
    const { title, message } = body;

    if (!title?.trim() || !message?.trim()) {
      return NextResponse.json(
        { error: "Title and message are required" },
        { status: 400 }
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

    // Poslať e-mail na info@verifa.sk
    try {
      await sendEmail({
        to: "info@verifa.sk",
        subject: `[Verifa.sk] ${title.trim()}`,
        text: `Od: ${user.email}\n\n${message.trim()}`,
        html: `<p><strong>Od:</strong> ${user.email}</p><p><strong>Predmet:</strong> ${title.trim()}</p><hr><p style="white-space: pre-wrap;">${message.trim()}</p>`,
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

    const body = await req.json();
    const { messageIds } = body;

    if (!Array.isArray(messageIds)) {
      return NextResponse.json(
        { error: "messageIds must be an array" },
        { status: 400 }
      );
    }

    // Označiť správy ako prečítané (len pre prihláseného používateľa)
    await prisma.userMessage.updateMany({
      where: {
        id: { in: messageIds },
        OR: [{ userId: null }, { userId: user.id }],
      },
      data: { read: true },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("PATCH /api/messages error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
