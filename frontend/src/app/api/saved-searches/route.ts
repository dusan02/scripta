import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "@/lib/auth";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const createSchema = z.object({
  name: z.string().min(1).max(200),
  filters: z.record(z.string(), z.string()),
});

// GET — list saved searches for the current user
export async function GET() {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searches = await prisma.savedSearch.findMany({
    where: { userId: session.user.id, deletedAt: null },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: { id: true, name: true, filters: true, createdAt: true, updatedAt: true },
  });

  return NextResponse.json({ searches });
}

// POST — create a new saved search
export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  // Limit: max 50 saved searches per user
  const count = await prisma.savedSearch.count({
    where: { userId: session.user.id, deletedAt: null },
  });
  if (count >= 50) {
    return NextResponse.json({ error: "Maximálny počet uložených vyhľadávaní je 50." }, { status: 400 });
  }

  const search = await prisma.savedSearch.create({
    data: {
      userId: session.user.id,
      name: parsed.data.name,
      filters: parsed.data.filters,
    },
  });

  return NextResponse.json({ id: search.id, name: search.name }, { status: 201 });
}

// DELETE — soft-delete a saved search
export async function DELETE(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const search = await prisma.savedSearch.findFirst({
    where: { id, userId: session.user.id, deletedAt: null },
  });
  if (!search) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.savedSearch.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
