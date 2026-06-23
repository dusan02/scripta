import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { orsrExtractType: true },
    });

    if (!dbUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ orsrExtractType: dbUser.orsrExtractType });
  } catch (error) {
    console.error("GET /api/settings error", error);
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
    const { orsrExtractType } = body;

    if (orsrExtractType !== "CURRENT" && orsrExtractType !== "FULL") {
      return NextResponse.json(
        { error: "orsrExtractType must be 'CURRENT' or 'FULL'" },
        { status: 400 }
      );
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { orsrExtractType },
    });

    return NextResponse.json({ ok: true, orsrExtractType });
  } catch (error) {
    console.error("PATCH /api/settings error", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
