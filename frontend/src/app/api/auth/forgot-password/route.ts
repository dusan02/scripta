import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/token";
import { rateLimit, rateLimitResponse } from "@/lib/rateLimit";
import { sendEmail, emailShell, emailButton } from "@/lib/email";
import { NEXTAUTH_URL } from "@/lib/env";
import { forgotPasswordSchema } from "@/lib/api-schemas";
import crypto from "crypto";

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { windowMs: 15 * 60 * 1000, maxRequests: 5, failClosed: true });
  if (!rl.allowed) return rateLimitResponse(rl);

  try {
    const body = await req.json().catch(() => null);
    const parsed = forgotPasswordSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ message: "E-mail je povinný." }, { status: 400 });
    }

    const { email } = parsed.data;
    const normalizedEmail = email.trim().toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    // Always return success to prevent email enumeration attacks
    if (!user) {
      return NextResponse.json({ message: "Ak účet existuje, zaslali sme e-mail s odkazom na obnovu hesla." });
    }

    // Generate secure token
    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 1000 * 60 * 60); // 1 hour

    // Delete any existing tokens for this email first (idempotent re-send),
    // then save the new hashed token (raw token goes only in the email link)
    await prisma.passwordResetToken.deleteMany({ where: { email: normalizedEmail } });
    await prisma.passwordResetToken.create({
      data: {
        email: normalizedEmail,
        token: hashToken(token),
        expires,
      },
    });

    const resetLink = `${NEXTAUTH_URL}/reset-password?token=${token}`;

    await sendEmail({
      to: normalizedEmail,
      subject: "Obnova hesla - Verifa.sk",
      text: `Dobrý deň,\n\nPožiadali ste o obnovu hesla k vášmu účtu na Verifa.sk.\n\nKliknite na nasledujúci odkaz pre nastavenie nového hesla:\n${resetLink}\n\nTento odkaz platí 1 hodinu.\n\nAk ste o túto zmenu nežiadali, môžete tento e-mail ignorovať.\n\nS pozdravom,\nTím Verifa.sk`,
      html: emailShell(`
        <h2>Obnova hesla</h2>
        <p>Dobrý deň,</p>
        <p>Požiadali ste o obnovu hesla k vášmu účtu na portáli <strong>Verifa.sk</strong>.</p>
        <p>${emailButton(resetLink, "Nastaviť nové heslo")}</p>
        <p style="color: #52525b; font-size: 14px;">Tento odkaz je platný 1 hodinu. Ak ste o zmenu hesla nežiadali, ignorujte tento e-mail.</p>
      `),
    });

    return NextResponse.json({ message: "Ak účet existuje, zaslali sme e-mail s odkazom na obnovu hesla." });
  } catch (error) {
    console.error("Forgot password error:", error);
    return NextResponse.json(
      { message: "Nastala neočakávaná chyba." },
      { status: 500 }
    );
  }
}
