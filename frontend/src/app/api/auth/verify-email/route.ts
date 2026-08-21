import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/token";
import { addCreditBatch } from "@/lib/credits";
import { rateLimit, rateLimitResponse } from "@/lib/rateLimit";

export async function GET(req: NextRequest) {
  // Rate limit: 20 attempts per 15 min per IP (prevents token brute-force, even though 32-byte tokens are impractical to guess)
  const rl = await rateLimit(req, { windowMs: 15 * 60 * 1000, maxRequests: 20, failClosed: true });
  if (!rl.allowed) return rateLimitResponse(rl);

  const token = req.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.json({ message: "Chýba verifikačný token." }, { status: 400 });
  }

  const hashedToken = hashToken(token);

  const verificationRecord = await prisma.verificationToken.findUnique({
    where: { token: hashedToken },
  });

  if (!verificationRecord) {
    return NextResponse.json({ message: "Neplatný verifikačný token." }, { status: 400 });
  }

  if (verificationRecord.expires < new Date()) {
    await prisma.verificationToken.delete({ where: { id: verificationRecord.id } });
    return NextResponse.json({ message: "Verifikačný token expiroval. Zareistrujte sa znova." }, { status: 400 });
  }

  // Atomic verification: update emailVerified + trialEndsAt + delete token in a transaction.
  // The conditional update (where: { emailVerified: null }) prevents double-credit
  // race conditions — only the first request succeeds, the second gets 0 rows updated.
  const trialEndsAt = new Date();
  trialEndsAt.setDate(trialEndsAt.getDate() + 30);

  const result = await prisma.$transaction(async (tx) => {
    // Conditional update — only succeeds if emailVerified is still null
    const updated = await tx.user.updateMany({
      where: { email: verificationRecord.email, emailVerified: null },
      data: { emailVerified: new Date(), trialEndsAt },
    });

    await tx.verificationToken.delete({ where: { id: verificationRecord.id } });

    return updated.count;
  });

  if (result === 0) {
    // emailVerified was already set by a concurrent request — no credit grant
    return NextResponse.json({ message: "Účet je už aktivovaný." });
  }

  // Fetch user ID outside transaction (addCreditBatch has its own transaction)
  const user = await prisma.user.findUnique({
    where: { email: verificationRecord.email },
    select: { id: true },
  });

  if (!user) {
    return NextResponse.json({ message: "Používateľ neexistuje." }, { status: 400 });
  }

  // Grant 1 free trial credit via CreditBatch (has its own transaction).
  // Idempotency: check if user already has a trial batch before granting.
  // This handles the race condition where the server crashes between
  // email verification and credit grant — a retry will find the existing
  // batch and skip re-granting.
  try {
    const existingTrial = await prisma.creditBatch.findFirst({
      where: { userId: user.id, source: "trial" },
      select: { id: true },
    });
    if (!existingTrial) {
      await addCreditBatch(user.id, 1, "trial");
    }
  } catch (err) {
    // Log error but don't fail the verification — user is already verified.
    // Admin can manually grant credits if needed.
    console.error(`[verify-email] Failed to grant trial credit to ${user.id}:`, err);
  }

  return NextResponse.json({ message: "Účet bol úspešne aktivovaný. Môžete sa prihlásiť." });
}
