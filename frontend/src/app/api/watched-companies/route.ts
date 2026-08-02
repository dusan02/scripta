import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { rateLimitByKey, rateLimitResponse } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const ICO_PATTERN = /^\d{8}$/;

const PLAN_LIMITS: Record<string, number> = {
  FREE: 3,
  STARTER: 10,
  PRO: 50,
  ENTERPRISE: 200,
};

// GET — list user's watched companies (IDOR protected)
export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const watched = await prisma.watchedCompany.findMany({
    where: { userId: user.id, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      companyId: true,
      note: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ watched });
}

// POST — add a company to watch list
export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Rate limit: 10 operations per minute per user
  const rl = await rateLimitByKey(`watched-companies:${user.id}`, {
    windowMs: 60 * 1000,
    maxRequests: 10,
  });
  if (!rl.allowed) return rateLimitResponse(rl);

  let body: { companyId?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const companyId = body.companyId?.trim();
  const note = body.note?.trim();

  if (!companyId || !ICO_PATTERN.test(companyId)) {
    return NextResponse.json({ error: "Valid 8-digit IČO is required" }, { status: 400 });
  }

  if (note && note.length > 500) {
    return NextResponse.json({ error: "Note must be at most 500 characters" }, { status: 400 });
  }

  // Check plan-based limit
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { planName: true },
  });
  const planName = dbUser?.planName || "FREE";
  const limit = PLAN_LIMITS[planName] ?? PLAN_LIMITS.FREE;

  const existingCount = await prisma.watchedCompany.count({
    where: { userId: user.id, deletedAt: null },
  });

  if (existingCount >= limit) {
    return NextResponse.json(
      { error: `Your plan allows up to ${limit} watched companies` },
      { status: 403 }
    );
  }

  // Upsert — if a soft-deleted entry exists, restore it
  const existing = await prisma.watchedCompany.findUnique({
    where: { userId_companyId: { userId: user.id, companyId } },
  });

  if (existing) {
    if (existing.deletedAt) {
      // Restore soft-deleted entry
      const restored = await prisma.watchedCompany.update({
        where: { id: existing.id },
        data: { deletedAt: null, note: note || null },
      });
      return NextResponse.json({ watched: restored, restored: true });
    }
    // Already watching
    return NextResponse.json({ error: "Already watching this company" }, { status: 409 });
  }

  const watched = await prisma.watchedCompany.create({
    data: {
      userId: user.id,
      companyId,
      note: note || null,
    },
  });

  return NextResponse.json({ watched }, { status: 201 });
}
