import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/reports/[id]/share
 * Owner-only: creates (or returns) the public share token for the HTML
 * report view. The shareable URL is {BASE_URL}/r/{shareToken}.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const report = await prisma.reportRequest.findUnique({
      where: { id: params.id },
      select: { id: true, userId: true, deletedAt: true, status: true, shareToken: true },
    });

    if (!report || report.deletedAt) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }
    if (report.userId !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (report.status !== "COMPLETED" && report.status !== "PARTIAL") {
      return NextResponse.json({ error: "Report is not ready" }, { status: 422 });
    }

    let token = report.shareToken;
    if (!token) {
      // 192-bit random token — unguessable, URL-safe
      token = randomToken();
      await prisma.reportRequest.update({
        where: { id: params.id },
        data: { shareToken: token },
      });
    }

    return NextResponse.json({ shareToken: token, sharePath: `/r/${token}` });
  } catch (error) {
    console.error("POST /api/reports/[id]/share error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE — revoke the share link (invalidates the public URL)
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const report = await prisma.reportRequest.findUnique({
      where: { id: params.id },
      select: { userId: true, deletedAt: true },
    });

    if (!report || report.deletedAt) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }
    if (report.userId !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await prisma.reportRequest.update({
      where: { id: params.id },
      data: { shareToken: null },
    });

    return NextResponse.json({ revoked: true });
  } catch (error) {
    console.error("DELETE /api/reports/[id]/share error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
