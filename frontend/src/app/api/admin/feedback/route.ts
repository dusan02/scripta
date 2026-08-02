import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { logAdminAction } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const [, error] = await requireAdmin(req);
    if (error) return error;

    const { searchParams } = new URL(req.url);
    const category = searchParams.get("category");
    const limit = Math.min(100, parseInt(searchParams.get("limit") || "50", 10));

    const where: Record<string, unknown> = {};
    if (category) {
      where.category = category;
    }

    const feedbacks = await prisma.feedback.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });

    return NextResponse.json({ feedbacks });
  } catch (error) {
    console.error("GET /api/admin/feedback error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const [adminUser, error] = await requireAdmin(req);
    if (error) return error;

    const body = await req.json();
    const { id, status } = body;

    if (!id || !status) {
      return NextResponse.json({ error: "ID and status are required" }, { status: 400 });
    }

    const validStatuses = ["OPEN", "RESOLVED", "CLOSED"];
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const feedback = await prisma.feedback.update({
      where: { id },
      data: { status },
    });

    await logAdminAction(adminUser.id, "FEEDBACK_UPDATE", id, { status }, req);

    return NextResponse.json({ ok: true, feedback });
  } catch (error) {
    console.error("PATCH /api/admin/feedback error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
