import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

const VALID_CATEGORIES = ["BUG", "IMPROVEMENT", "QUESTION", "OTHER"] as const;

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
