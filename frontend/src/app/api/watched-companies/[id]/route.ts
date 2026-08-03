import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { rateLimitByKey, rateLimitResponse } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// PATCH — update note for a watched company (IDOR protected)
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const watched = await prisma.watchedCompany.findFirst({
    where: { id: params.id, userId: user.id, deletedAt: null },
  });

  if (!watched) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: { note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const note = body.note?.trim() || null;

  const updated = await prisma.watchedCompany.update({
    where: { id: watched.id },
    data: { note },
    select: { id: true, companyId: true, note: true, createdAt: true, updatedAt: true },
  });

  return NextResponse.json({ watched: updated });
}

// DELETE — soft-delete a watched company (IDOR protected)
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Rate limit: 10 operations per minute per user
  const rl = await rateLimitByKey(`watched-companies:${user.id}`, {
    windowMs: 60 * 1000,
    maxRequests: 10,
  });
  if (!rl.allowed) return rateLimitResponse(rl);

  const watched = await prisma.watchedCompany.findFirst({
    where: { id: params.id, userId: user.id, deletedAt: null },
  });

  if (!watched) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Soft delete
  await prisma.watchedCompany.update({
    where: { id: watched.id },
    data: { deletedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
