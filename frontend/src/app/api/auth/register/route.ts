import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit, rateLimitResponse, rateLimitByKey } from "@/lib/rateLimit";
import { hashToken } from "@/lib/token";
import { sendEmail, emailButtonStyle } from "@/lib/email";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { z } from "zod";

const registerSchema = z.object({
  email: z.string().email("Neplatný formát e-mailu").toLowerCase(),
  password: z.string().min(8, "Heslo musí mať aspoň 8 znakov"),
});

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { windowMs: 60 * 60 * 1000, maxRequests: 5 });
  if (!rl.allowed) return rateLimitResponse(rl);

  try {
    const body = await req.json();
    const result = registerSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { message: result.error.errors[0].message },
        { status: 400 }
      );
    }

    const { email, password } = result.data;

    // Email-based rate limit: 3 registrations per email per 24h
    const emailRl = await rateLimitByKey(`register:${email}`, { windowMs: 24 * 60 * 60 * 1000, maxRequests: 3 });
    if (!emailRl.allowed) return rateLimitResponse(emailRl);

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      if (existingUser.emailVerified) {
        // Already verified — cannot re-register
        return NextResponse.json(
          { message: "Používateľ s týmto e-mailom už existuje." },
          { status: 400 }
        );
      }

      // Not verified yet — update password, delete old token, send new verification email
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(password, salt);
      await prisma.user.update({ where: { email }, data: { passwordHash } });
      await prisma.verificationToken.deleteMany({ where: { email } });

      const token = crypto.randomBytes(32).toString("hex");
      const expires = new Date(Date.now() + 1000 * 60 * 60 * 24);
      await prisma.verificationToken.create({ data: { email, token: hashToken(token), expires } });

      const verifyLink = `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/verify-email?token=${token}`;
      await sendEmail({
        to: email,
        subject: `Nový verifikačný odkaz - Verifa.sk (${new Date().toLocaleTimeString("sk-SK")})`,
        text: `Dobrý deň,\n\nPoslali sme vám nový verifikačný odkaz.\n\n${verifyLink}\n\nTento odkaz platí 24 hodín.`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #09090b;">
            <h2>Verifa.sk — nový verifikačný odkaz</h2>
            <p>Dobrý deň,</p>
            <p>Poslali sme vám nový odkaz na aktiváciu účtu:</p>
            <p><a href="${verifyLink}" style="${emailButtonStyle()}">Aktivovať účet</a></p>
            <p style="color: #52525b; font-size: 14px;">Tento odkaz je platný 24 hodín.</p>
            <hr style="border: none; border-top: 1px solid #e4e4e7; margin: 24px 0;">
            <p style="color: #a1a1aa; font-size: 12px;">Verifa.sk — Business Risk Report zo štátnych registrov SR.</p>
          </div>
        `,
      });

      return NextResponse.json(
        { message: "Poslali sme nový verifikačný e-mail. Skontrolujte svoju schránku." },
        { status: 200 }
      );
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Create user (emailVerified = null, requires verification)
    const newUser = await prisma.user.create({
      data: {
        email,
        passwordHash,
      },
    });

    // Grant 1 trial credit (valid 90 days)
    const creditExpiry = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    await prisma.creditBatch.create({
      data: {
        userId: newUser.id,
        amount: 1,
        remaining: 1,
        source: "trial",
        expiresAt: creditExpiry,
      },
    });

    // Generate verification token
    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24 hours

    await prisma.verificationToken.create({
      data: {
        email,
        token: hashToken(token),
        expires,
      },
    });

    // Send verification email
    const verifyLink = `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/verify-email?token=${token}`;

    await sendEmail({
      to: email,
      subject: "Potvrdenie registrácie - Verifa.sk",
      text: `Dobrý deň,\n\nĎakujeme za registráciu na Verifa.sk.\n\nPre aktiváciu vášho účtu kliknite na nasledujúci odkaz:\n${verifyLink}\n\nTento odkaz platí 24 hodín.\n\nAk ste sa neregistrovali, môžete tento e-mail ignorovať.\n\nS pozdravom,\nTím Verifa.sk`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #09090b;">
          <h2>Vitajte na Verifa.sk</h2>
          <p>Dobrý deň,</p>
          <p>Ďakujeme za registráciu. Pre aktiváciu vášho účtu kliknite na tlačidlo nižšie:</p>
          <p>
            <a href="${verifyLink}" style="${emailButtonStyle()}">Aktivovať účet</a>
          </p>
          <p style="color: #52525b; font-size: 14px;">Tento odkaz je platný 24 hodín. Ak ste sa neregistrovali, ignorujte tento e-mail.</p>
          <hr style="border: none; border-top: 1px solid #e4e4e7; margin: 24px 0;">
          <p style="color: #a1a1aa; font-size: 12px;">Verifa.sk — Business Risk Report zo štátnych registrov SR.</p>
        </div>
      `,
    });

    return NextResponse.json(
      { message: "Registrácia úspešná. Skontrolujte svoj e-mail pre aktiváciu účtu.", userId: newUser.id },
      { status: 201 }
    );
  } catch (error) {
    console.error("Register error:", error);
    return NextResponse.json(
      { message: "Nastala neočakávaná chyba pri registrácii." },
      { status: 500 }
    );
  }
}
