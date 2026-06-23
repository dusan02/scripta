import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/token";
import { rateLimit, rateLimitResponse } from "@/lib/rateLimit";
import crypto from "crypto";
import nodemailer from "nodemailer";

export async function POST(req: NextRequest) {
  const rl = rateLimit(req, { windowMs: 15 * 60 * 1000, maxRequests: 5 });
  if (!rl.allowed) return rateLimitResponse(rl);

  try {
    const { email } = await req.json();

    if (!email) {
      return NextResponse.json({ message: "E-mail je povinný." }, { status: 400 });
    }

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

    // Save hashed token to DB (raw token goes only in the email link)
    await prisma.passwordResetToken.create({
      data: {
        email: normalizedEmail,
        token: hashToken(token),
        expires,
      },
    });

    // Send email using nodemailer
    const resetLink = `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/reset-password?token=${token}`;

    if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
      // Development mode / Missing SMTP credentials
      console.log("============================================");
      console.log("MOCK EMAIL SENDING (Missing SMTP variables):");
      console.log("To:", normalizedEmail);
      console.log("Subject: Obnova hesla - Registro.sk");
      console.log("Reset Link:", resetLink);
      console.log("============================================");
    } else {
      // Production mode with SMTP
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: Number(process.env.SMTP_PORT) === 465,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      await transporter.sendMail({
        from: process.env.EMAIL_FROM || '"Registro.sk" <noreply@registro.sk>',
        to: normalizedEmail,
        subject: "Obnova hesla - Registro.sk",
        text: `Dobrý deň,\n\nPožiadali ste o obnovu hesla k vášmu účtu na Registro.sk.\n\nKliknite na nasledujúci odkaz pre nastavenie nového hesla:\n${resetLink}\n\nTento odkaz platí 1 hodinu.\n\nAk ste o túto zmenu nežiadali, môžete tento e-mail ignorovať.\n\nS pozdravom,\nTím Registro.sk`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #09090b;">
            <h2>Obnova hesla</h2>
            <p>Dobrý deň,</p>
            <p>Požiadali ste o obnovu hesla k vášmu účtu na portáli <strong>Registro.sk</strong>.</p>
            <p>
              <a href="${resetLink}" style="display: inline-block; background-color: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; margin-top: 8px;">Nastaviť nové heslo</a>
            </p>
            <p style="color: #52525b; font-size: 14px;">Tento odkaz je platný 1 hodinu. Ak ste o zmenu hesla nežiadali, ignorujte tento e-mail.</p>
          </div>
        `,
      });
    }

    return NextResponse.json({ message: "Ak účet existuje, zaslali sme e-mail s odkazom na obnovu hesla." });
  } catch (error) {
    console.error("Forgot password error:", error);
    return NextResponse.json(
      { message: "Nastala neočakávaná chyba." },
      { status: 500 }
    );
  }
}
