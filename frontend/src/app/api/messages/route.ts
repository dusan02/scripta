import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);

    // Správy pre všetkých (userId = null) + správy pre konkrétneho používateľa
    const where = user
      ? { OR: [{ userId: null }, { userId: user.id }] }
      : { userId: null };

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
