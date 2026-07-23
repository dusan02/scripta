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
  name: z.string().min(2, "Meno musí mať aspoň 2 znaky"),
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

    const { name, email, password } = result.data;

    // Email-based rate limit: 3 registrations per email per 24h
    const emailRl = await rateLimitByKey(`register:${email}`, { windowMs: 24 * 60 * 60 * 1000, maxRequests: 3 });
    if (!emailRl.allowed) return rateLimitResponse(emailRl);

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return NextResponse.json(
        { message: "Používateľ s týmto e-mailom už existuje." },
        { status: 400 }
      );
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Create user (emailVerified = null, requires verification)
    const newUser = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
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
      text: `Dobrý deň ${name},\n\nĎakujeme za registráciu na Verifa.sk.\n\nPre aktiváciu vášho účtu kliknite na nasledujúci odkaz:\n${verifyLink}\n\nTento odkaz platí 24 hodín.\n\nAk ste sa neregistrovali, môžete tento e-mail ignorovať.\n\nS pozdravom,\nTím Verifa.sk`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #09090b;">
          <h2>Vitajte na Verifa.sk</h2>
          <p>Dobrý deň ${name},</p>
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
