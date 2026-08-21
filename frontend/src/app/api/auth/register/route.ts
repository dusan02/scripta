import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { rateLimit, rateLimitResponse, rateLimitByKey } from "@/lib/rateLimit";
import { hashToken } from "@/lib/token";
import { sendEmail, emailShell, emailButton } from "@/lib/email";
import { escapeHtml } from "@/lib/sanitize";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { z } from "zod";

const registerSchema = z.object({
  email: z.string().email("Neplatný formát e-mailu").toLowerCase(),
  password: z.string().min(8, "Heslo musí mať aspoň 8 znakov"),
});

// Appends invisible zero-width characters to the subject so email clients
// (e.g. Gmail) don't collapse/thread multiple verification emails together.
function uniqueSubjectSuffix(): string {
  const count = 1 + Math.floor(Math.random() * 20);
  return "\u200B".repeat(count);
}

import { NEXTAUTH_URL as BASE_URL } from "@/lib/env";
const TOKEN_EXPIRY_MS = 1000 * 60 * 60 * 24; // 24 hours

/** Hash a password using bcrypt with a fresh salt. */
async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

/** Generate a verification token, persist its hash to the DB, and return the raw token. */
async function createVerificationToken(email: string): Promise<string> {
  // Delete any existing tokens for this email first (idempotent re-send).
  await prisma.verificationToken.deleteMany({ where: { email } });

  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + TOKEN_EXPIRY_MS);
  await prisma.verificationToken.create({
    data: { email, token: hashToken(token), expires },
  });
  return token;
}

/** Send the verification email with the activation link. */
async function sendVerificationEmail(email: string, token: string, isNew: boolean): Promise<void> {
  const verifyLink = `${BASE_URL}/verify-email?token=${token}`;
  const subject = isNew
    ? `Potvrdenie registrácie - Verifa.sk${uniqueSubjectSuffix()}`
    : `Nový verifikačný odkaz - Verifa.sk${uniqueSubjectSuffix()}`;

  const heading = isNew ? "Vitajte na Verifa.sk" : "Verifa.sk — nový verifikačný odkaz";
  const intro = isNew
    ? "Ďakujeme za registráciu. Pre aktiváciu vášho účtu kliknite na tlačidlo nižšie:"
    : "Poslali sme vám nový odkaz na aktiváciu účtu:";
  const footer = isNew
    ? "Tento odkaz je platný 24 hodín. Ak ste sa neregistrovali, ignorujte tento e-mail."
    : "Tento odkaz je platný 24 hodín.";
  const textIntro = isNew
    ? "Ďakujeme za registráciu na Verifa.sk.\n\nPre aktiváciu vášho účtu kliknite na nasledujúci odkaz:"
    : "Poslali sme vám nový verifikačný odkaz.";

  await sendEmail({
    to: email,
    subject,
    text: `Dobrý deň,\n\n${textIntro}\n${verifyLink}\n\n${footer}\n\nS pozdravom,\nTím Verifa.sk`,
    html: emailShell(`
      <div style="display:none; max-height:0; overflow:hidden; opacity:0;">Kliknite na odkaz pre aktiváciu vášho účtu na Verifa.sk</div>
      <h2>${heading}</h2>
      <p>Dobrý deň,</p>
      <p>${intro}</p>
      <p>${emailButton(verifyLink, "Aktivovať účet")}</p>
      <p style="color: #52525b; font-size: 14px;">${footer}</p>
    `),
  });
}

/** Send an admin notification email about a new registration. */
async function sendAdminRegistrationNotification(email: string, userId: string): Promise<void> {
  const timestamp = new Date().toISOString();
  try {
    await sendEmail({
      to: "info@verifa.sk",
      subject: `[Verifa.sk] Nová registrácia — ${email}`,
      text:
        `Nový používateľ sa zaregistroval.\n\n` +
        `E-mail: ${email}\n` +
        `ID: ${userId}\n` +
        `Čas: ${timestamp}\n\n` +
        `Účet čaká na e-mailovú verifikáciu.`,
      html:
        `<h2>Nová registrácia</h2>` +
        `<p><strong>E-mail:</strong> ${escapeHtml(email)}</p>` +
        `<p><strong>ID:</strong> ${escapeHtml(userId)}</p>` +
        `<p><strong>Čas:</strong> ${escapeHtml(timestamp)}</p>` +
        `<p style="color: #52525b;">Účet čaká na e-mailovú verifikáciu.</p>`,
    });
  } catch (err) {
    console.error("[register] Failed to send admin notification email", err);
  }
}

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { windowMs: 60 * 60 * 1000, maxRequests: 5, failClosed: true });
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
    const emailRl = await rateLimitByKey(`register:${email}`, { windowMs: 24 * 60 * 60 * 1000, maxRequests: 3, failClosed: true });
    if (!emailRl.allowed) return rateLimitResponse(emailRl);

    // Check if user exists
    const existingUser = await prisma.user.findUnique({ where: { email } });

    if (existingUser) {
      if (existingUser.emailVerified) {
        return NextResponse.json(
          { message: "Používateľ s týmto e-mailom už existuje." },
          { status: 400 }
        );
      }

      // Not verified yet — update password and send new verification email
      await prisma.user.update({
        where: { email },
        data: { passwordHash: await hashPassword(password) },
      });

      const token = await createVerificationToken(email);
      await sendVerificationEmail(email, token, false);

      return NextResponse.json(
        { message: "Poslali sme nový verifikačný e-mail. Skontrolujte svoju schránku." },
        { status: 200 }
      );
    }

    // New user — create account (emailVerified = null, requires verification)
    const newUser = await prisma.user.create({
      data: { email, passwordHash: await hashPassword(password) },
    });

    // Trial credit is granted upon email verification via addCreditBatch
    // (which also updates the wallet balance). Do NOT create a CreditBatch here —
    // it would bypass the wallet and leave a phantom batch with remaining=1.

    const token = await createVerificationToken(email);
    await sendVerificationEmail(email, token, true);
    await sendAdminRegistrationNotification(email, newUser.id);

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
