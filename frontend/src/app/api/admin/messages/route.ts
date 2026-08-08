import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { logAdminAction } from "@/lib/audit";
import { sendEmail, emailShell, getReplyToAddress } from "@/lib/email";
import { escapeHtml } from "@/lib/sanitize";

// GET — list all USER messages + all messages for admin
//       ?search=email → search users by email (for compose target lookup)
export async function GET(req: NextRequest) {
  try {
    const [, error] = await requireAdmin(req);
    if (error) return error;

    const url = new URL(req.url);
    const filter = url.searchParams.get("filter") || "inbox";
    const search = url.searchParams.get("search");

    // User search by email (for compose target autocomplete)
    if (search) {
      const users = await prisma.user.findMany({
        where: {
          email: { contains: search.toLowerCase(), mode: "insensitive" },
          deletedAt: null,
        },
        select: { id: true, email: true, name: true },
        take: 10,
      });
      return NextResponse.json({ users });
    }

    let where: Record<string, unknown> = { deletedAt: null };
    if (filter === "inbox") {
      where = { type: "USER", deletedAt: null };
    } else if (filter === "sent") {
      where = { type: { in: ["ANNOUNCEMENT", "REPLY", "SYSTEM"] }, senderId: { not: null }, deletedAt: null };
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
    const [adminUser, error] = await requireAdmin(req);
    if (error) return error;

    const body = await req.json();
    const { title, message, type, targetUserId, replyToMessageId } = body;

    if (!title?.trim() || !message?.trim()) {
      return NextResponse.json(
        { error: "Title and message are required" },
        { status: 400 }
      );
    }

    // If replying to a specific user message, extract userId from it
    let resolvedTargetUserId = targetUserId || null;
    if (replyToMessageId && !resolvedTargetUserId) {
      const originalMsg = await prisma.userMessage.findUnique({
        where: { id: replyToMessageId },
        select: { senderId: true, type: true },
      });
      if (originalMsg?.senderId && originalMsg.type === "USER") {
        resolvedTargetUserId = originalMsg.senderId;
      }
    }

    const msgType = (type || (replyToMessageId ? "REPLY" : "ANNOUNCEMENT")) as "ANNOUNCEMENT" | "REPLY" | "SYSTEM";

    // If targetUserId is provided, send to specific user; otherwise broadcast (userId = null)
    const msg = await prisma.userMessage.create({
      data: {
        type: msgType,
        senderId: adminUser.id,
        userId: resolvedTargetUserId,
        title: title.trim().slice(0, 200),
        body: message.trim().slice(0, 5000),
      },
    });

    // If targeted, send email notification
    let emailSkipped = false;
    if (resolvedTargetUserId) {
      const targetUser = await prisma.user.findUnique({
        where: { id: resolvedTargetUserId },
        select: { email: true, emailBounced: true, deletedAt: true },
      });
      if (!targetUser) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }
      if (targetUser.emailBounced || targetUser.deletedAt) {
        emailSkipped = true;
      } else {
        try {
          await sendEmail({
            to: targetUser.email,
            subject: `[Verifa.sk] ${title.trim()}`,
            text: message.trim(),
            html: emailShell(`
              <p style="white-space: pre-wrap;">${escapeHtml(message.trim())}</p>
              <p style="font-size: 12px; color: #888;">Táto správa bola odoslaná z admin panelu Verifa.sk. Môžete odpovedať priamo na tento e-mail.</p>
            `),
            replyTo: getReplyToAddress(resolvedTargetUserId),
          });
        } catch (emailErr) {
          console.error("Failed to send email to user", emailErr);
          emailSkipped = true;
        }
      }
    } else {
      // Broadcast — send to all verified users with valid email
      const users = await prisma.user.findMany({
        where: { emailVerified: { not: null }, emailBounced: false, deletedAt: null },
        select: { email: true },
      });
      for (const u of users) {
        try {
          await sendEmail({
            to: u.email,
            subject: `[Verifa.sk] ${title.trim()}`,
            text: message.trim(),
            html: emailShell(`
              <p style="white-space: pre-wrap;">${escapeHtml(message.trim())}</p>
              <p style="font-size: 12px; color: #888;">Táto správa bola odoslaná z admin panelu Verifa.sk.</p>
            `),
          });
        } catch (emailErr) {
          console.error(`Failed to send email to ${u.email}`, emailErr);
        }
      }
    }

    await logAdminAction(adminUser.id, "MESSAGE_SEND", resolvedTargetUserId || null, {
      messageId: msg.id,
      type: msgType,
      broadcast: !resolvedTargetUserId,
      replyTo: replyToMessageId || null,
      emailSkipped,
    }, req);

    return NextResponse.json({ ok: true, id: msg.id, emailSkipped });
  } catch (error) {
    console.error("POST /api/admin/messages error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
