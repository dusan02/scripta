import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { sendEmail } from "@/lib/email";

// GET — list all USER messages + all messages for admin
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { role: true },
    });

    if (dbUser?.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const url = new URL(req.url);
    const filter = url.searchParams.get("filter") || "inbox";

    let where: Record<string, unknown> = {};
    if (filter === "inbox") {
      where = { type: "USER" };
    } else if (filter === "sent") {
      where = { type: { in: ["ANNOUNCEMENT", "REPLY", "SYSTEM"] }, senderId: { not: null } };
    }

    const messages = await prisma.userMessage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        sender: {
          select: { id: true, email: true, name: true },
        },
      },
    });

    return NextResponse.json({ messages });
  } catch (error) {
    console.error("GET /api/admin/messages error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST — admin sends announcement/reply to a user or broadcast
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { role: true, email: true },
    });

    if (dbUser?.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const { title, message, type, targetUserId } = body;

    if (!title?.trim() || !message?.trim()) {
      return NextResponse.json(
        { error: "Title and message are required" },
        { status: 400 }
      );
    }

    const msgType = (type || "ANNOUNCEMENT") as "ANNOUNCEMENT" | "REPLY" | "SYSTEM";

    // If targetUserId is provided, send to specific user; otherwise broadcast (userId = null)
    const msg = await prisma.userMessage.create({
      data: {
        type: msgType,
        senderId: user.id,
        userId: targetUserId || null,
        title: title.trim().slice(0, 200),
        body: message.trim().slice(0, 5000),
      },
    });

    // If targeted, send email notification
    if (targetUserId) {
      const targetUser = await prisma.user.findUnique({
        where: { id: targetUserId },
        select: { email: true },
      });
      if (targetUser) {
        try {
          await sendEmail({
            to: targetUser.email,
            subject: `[Verifa.sk] ${title.trim()}`,
            text: message.trim(),
            html: `<p style="white-space: pre-wrap;">${message.trim()}</p><hr><p style="font-size: 12px; color: #888;">Táto správa bola odoslaná z admin panelu Verifa.sk.</p>`,
          });
        } catch (emailErr) {
          console.error("Failed to send email to user", emailErr);
        }
      }
    } else {
      // Broadcast — send to all users
      const users = await prisma.user.findMany({
        where: { emailVerified: { not: null } },
        select: { email: true },
      });
      for (const u of users) {
        try {
          await sendEmail({
            to: u.email,
            subject: `[Verifa.sk] ${title.trim()}`,
            text: message.trim(),
            html: `<p style="white-space: pre-wrap;">${message.trim()}</p><hr><p style="font-size: 12px; color: #888;">Táto správa bola odoslaná z admin panelu Verifa.sk.</p>`,
          });
        } catch (emailErr) {
          console.error(`Failed to send email to ${u.email}`, emailErr);
        }
      }
    }

    return NextResponse.json({ ok: true, id: msg.id });
  } catch (error) {
    console.error("POST /api/admin/messages error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
