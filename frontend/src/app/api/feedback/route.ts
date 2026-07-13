import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { sendEmail } from "@/lib/email";

const VALID_CATEGORIES = ["BUG", "IMPROVEMENT", "QUESTION", "OTHER"] as const;

const CATEGORY_LABELS: Record<string, string> = {
  BUG: "Chyba",
  IMPROVEMENT: "Nápad na zlepšenie",
  QUESTION: "Otázka",
  OTHER: "Iné",
};

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { category, requestId, message } = body;

    if (!category || !VALID_CATEGORIES.includes(category)) {
      return NextResponse.json(
        { error: "Kategória je povinná (BUG, IMPROVEMENT, QUESTION, OTHER)" },
        { status: 400 }
      );
    }

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return NextResponse.json(
        { error: "Text správy je povinný" },
        { status: 400 }
      );
    }

    const feedback = await prisma.feedback.create({
      data: {
        userId: user.id,
        category,
        requestId: requestId || null,
        message: message.trim(),
      },
    });

    // Vytvoriť aj UserMessage záznam — objaví sa v "Odoslané" na /messages
    const categoryLabel = CATEGORY_LABELS[category] || category;
    const title = requestId
      ? `[${categoryLabel}] ${requestId}`
      : `[${categoryLabel}] Spätná väzba`;

    await prisma.userMessage.create({
      data: {
        type: "USER",
        senderId: user.id,
        title: title.slice(0, 200),
        body: message.trim().slice(0, 5000),
        feedbackId: feedback.id,
      },
    });

    // Poslať e-mail na info@verifa.sk
    try {
      await sendEmail({
        to: "info@verifa.sk",
        subject: `[Verifa.sk] ${title}`,
        text: `Od: ${user.email}\nKategória: ${categoryLabel}\n${requestId ? `Request ID: ${requestId}\n` : ""}\n${message.trim()}`,
        html: `<p><strong>Od:</strong> ${user.email}</p><p><strong>Kategória:</strong> ${categoryLabel}</p>${requestId ? `<p><strong>Request ID:</strong> ${requestId}</p>` : ""}<hr><p style="white-space: pre-wrap;">${message.trim()}</p>`,
      });
    } catch (emailErr) {
      console.error("Failed to send feedback email", emailErr);
    }

    return NextResponse.json({ ok: true, id: feedback.id });
  } catch (error) {
    console.error("POST /api/feedback error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const feedbacks = await prisma.feedback.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return NextResponse.json({ feedbacks });
  } catch (error) {
    console.error("GET /api/feedback error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
