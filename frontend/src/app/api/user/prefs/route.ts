import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "@/lib/auth";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID_COLUMNS = [
  "name", "ico", "legalForm", "city", "establishedAt",
  "latestRevenue", "latestProfit", "latestAssets", "latestEquity",
];

const patchSchema = z.object({
  screenerColumns: z.array(z.string()).optional(),
});

// PATCH — update user preferences
export async function PATCH(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  // Fetch current prefs
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { screenerPrefs: true },
  });

  const currentPrefs = (user?.screenerPrefs as Record<string, unknown> | null) || {};

  if (parsed.data.screenerColumns) {
    // Validate columns
    const cols = parsed.data.screenerColumns.filter(c => VALID_COLUMNS.includes(c));
    currentPrefs.columns = cols;
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { screenerPrefs: JSON.stringify(currentPrefs) },
  });

  return NextResponse.json({ ok: true });
}

// GET — fetch user preferences
export async function GET() {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { screenerPrefs: true },
  });

  const prefs = (user?.screenerPrefs as Record<string, unknown> | null) || {};
  return NextResponse.json({ prefs });
}
