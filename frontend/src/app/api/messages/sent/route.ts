import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const messages = await prisma.userMessage.findMany({
      where: {
        type: "USER",
        senderId: user.id,
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return NextResponse.json({ messages });
  } catch (error) {
    console.error("GET /api/messages/sent error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
