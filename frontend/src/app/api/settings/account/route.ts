import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import bcrypt from "bcryptjs";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/settings/account
 *
 * Permanently deletes the authenticated user's account and all associated
 * data (reports, wallet, credit batches, feedback, messages) via CASCADE.
 *
 * Requires password confirmation for security.
 *
 * GDPR Article 17 — Right to erasure ("right to be forgotten").
 */
export async function DELETE(req: NextRequest) {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { password } = body as { password?: string };

    if (!password) {
      return NextResponse.json(
        { error: "Password confirmation is required to delete your account." },
        { status: 400 }
      );
    }

    // Verify password
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, email: true, passwordHash: true, role: true },
    });

    if (!dbUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // OAuth-only accounts (no passwordHash) cannot confirm via password.
    // For now, these accounts must contact support for deletion.
    if (!dbUser.passwordHash) {
      return NextResponse.json(
        { error: "Your account uses social login. Please contact support@verifa.sk to delete your account." },
        { status: 400 }
      );
    }

    const passwordValid = await bcrypt.compare(password, dbUser.passwordHash);
    if (!passwordValid) {
      return NextResponse.json(
        { error: "Incorrect password." },
        { status: 403 }
      );
    }

    // Prevent admin self-deletion (last admin protection could be added here)
    if (dbUser.role === "ADMIN") {
      const adminCount = await prisma.user.count({ where: { role: "ADMIN" } });
      if (adminCount <= 1) {
        return NextResponse.json(
          { error: "Cannot delete the last admin account. Please assign another admin first." },
          { status: 400 }
        );
      }
    }

    // Hard delete — CASCADE removes:
    //   - ReportRequest (→ ReportSource)
    //   - Wallet (→ WalletTransaction)
    //   - CreditBatch
    //   - Feedback
    //   - UserMessage (userId)
    //   - UserMessage (senderId → SetNull, messages preserved)
    await prisma.user.delete({
      where: { id: user.id },
    });

    console.log(`[ACCOUNT] User ${dbUser.email} (${user.id}) deleted their account (GDPR Article 17).`);

    return NextResponse.json({ ok: true, message: "Account permanently deleted." });
  } catch (error) {
    console.error("DELETE /api/settings/account error:", error);
    return NextResponse.json(
      { error: "Failed to delete account. Please contact support@verifa.sk." },
      { status: 500 }
    );
  }
}
