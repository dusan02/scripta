import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { sendEmail, getReplyToAddress } from "@/lib/email";
import { escapeHtml } from "@/lib/sanitize";
import { rateLimit, rateLimitResponse } from "@/lib/rateLimit";
import { translate, normalizeLang } from "@/lib/i18n";

const VALID_CATEGORIES = ["BUG", "IMPROVEMENT", "QUESTION", "OTHER"] as const;

const CATEGORY_LABEL_KEYS: Record<string, string> = {
  BUG: "email.feedbackChyba",
  IMPROVEMENT: "email.feedbackNavrh",
  QUESTION: "email.feedbackOtazka",
  OTHER: "email.feedbackIne",
};

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Fetch user's language preference for i18n
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { reportLanguage: true },
    });
    const lang = normalizeLang(dbUser?.reportLanguage);

    // Rate limit: 5 feedback submissions per 10 minutes per user
    const rl = await rateLimit(req, { windowMs: 10 * 60 * 1000, maxRequests: 5 });
    if (!rl.allowed) return rateLimitResponse(rl);

    const body = await req.json();
    const { category, requestId, message } = body;

    if (!category || !VALID_CATEGORIES.includes(category)) {
      return NextResponse.json(
        { error: translate(lang, "email.feedbackKategoriaPovinna") },
        { status: 400 }
      );
    }

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return NextResponse.json(
        { error: translate(lang, "email.feedbackTextPovinny") },
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
    const categoryLabel = translate(lang, CATEGORY_LABEL_KEYS[category] || "email.feedbackIne");
    const feedbackTitle = translate(lang, "email.feedbackSpatnaVazba");
    const title = requestId
      ? `[${categoryLabel}] ${requestId}`
      : `[${categoryLabel}] ${feedbackTitle}`;

    await prisma.userMessage.create({
      data: {
        type: "USER",
        senderId: user.id,
        title: title.slice(0, 200),
        body: message.trim().slice(0, 5000),
        feedbackId: feedback.id,
      },
    });

    // Poslať e-mail na info@verifa.sk s reply-to obsahujúcim userId používateľa
    try {
      await sendEmail({
        to: "info@verifa.sk",
        replyTo: getReplyToAddress(user.id),
        subject: `[Verifa.sk] ${title}`,
        text: `Od: ${user.email}\nKategória: ${categoryLabel}\n${requestId ? `Request ID: ${requestId}\n` : ""}\n${message.trim()}`,
        html: `<p><strong>Od:</strong> ${escapeHtml(user.email)}</p><p><strong>Kategória:</strong> ${escapeHtml(categoryLabel)}</p>${requestId ? `<p><strong>Request ID:</strong> ${escapeHtml(requestId)}</p>` : ""}<hr><p style="white-space: pre-wrap;">${escapeHtml(message.trim())}</p>`,
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
