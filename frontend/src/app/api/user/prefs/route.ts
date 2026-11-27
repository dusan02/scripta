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

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  // Fetch current prefs
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { screenerPrefs: true },
  });

  let currentPrefs: Record<string, unknown> = {};
  if (typeof user?.screenerPrefs === "string") {
    try {
      const parsedLegacy = JSON.parse(user.screenerPrefs);
      if (parsedLegacy && typeof parsedLegacy === "object" && !Array.isArray(parsedLegacy)) {
        currentPrefs = { ...(parsedLegacy as Record<string, unknown>) };
      }
    } catch {
      currentPrefs = {};
    }
  } else if (user?.screenerPrefs && typeof user.screenerPrefs === "object" && !Array.isArray(user.screenerPrefs)) {
    currentPrefs = { ...(user.screenerPrefs as Record<string, unknown>) };
  }

  if (parsed.data.screenerColumns) {
    // Validate columns
    const cols = parsed.data.screenerColumns.filter(c => VALID_COLUMNS.includes(c));
    currentPrefs.columns = cols;
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { screenerPrefs: currentPrefs as any },
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

  let prefs: Record<string, unknown> = {};
  if (typeof user?.screenerPrefs === "string") {
    try {
      const parsedLegacy = JSON.parse(user.screenerPrefs);
      if (parsedLegacy && typeof parsedLegacy === "object" && !Array.isArray(parsedLegacy)) {
        prefs = parsedLegacy as Record<string, unknown>;
      }
    } catch {
      prefs = {};
    }
  } else if (user?.screenerPrefs && typeof user.screenerPrefs === "object" && !Array.isArray(user.screenerPrefs)) {
    prefs = user.screenerPrefs as Record<string, unknown>;
  }
  return NextResponse.json({ prefs });
}
