import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ count: 0 });
    }

    const count = await prisma.userMessage.count({
      where: {
        AND: [
          { OR: [{ userId: null }, { userId: user.id }] },
          { NOT: { type: "USER" as const } },
          { read: false },
        ],
      },
    });

    return NextResponse.json(
      { count },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
    );
  } catch (error) {
    console.error("GET /api/messages/unread error", error);
    return NextResponse.json({ count: 0 });
  }
}
