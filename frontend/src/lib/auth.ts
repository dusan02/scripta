import { NextAuthOptions, getServerSession as nextAuthGetServerSession } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { addCreditBatch } from "@/lib/credits";
import { rateLimitByKey } from "@/lib/rateLimit";
import { sendEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/sanitize";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AuthUser = {
  id: string;
  email: string;
  name?: string | null;
  role?: string;
};

// Augment next-auth types so session.user.id is available with full typing.
declare module "next-auth" {
  interface Session {
    user: AuthUser;
  }
  interface User {
    id: string;
    email: string;
    name?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    tokenVersion: number;
    lastVerified?: number;
    role?: string;
  }
}

const JWT_VERIFY_INTERVAL_MS = 5 * 60 * 1000; // 5 minút

// ─── Auth Options ─────────────────────────────────────────────────────────────

// NEXTAUTH_SECRET — fail-fast only at production RUNTIME (not during build).
// During `next build`, Next.js evaluates route modules to collect page data.
// NEXT_PHASE may not be reliably propagated to all modules in all environments,
// so we only throw when we're certain we're in a running server (phase-production-server).
// The real protection is docker-compose.yml's `${NEXTAUTH_SECRET:?must be set}`.
const _isProductionServer = process.env.NODE_ENV === "production" && process.env.NEXT_PHASE === "phase-production-server";
const _NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET;
if (!_NEXTAUTH_SECRET) {
  if (_isProductionServer) {
    throw new Error("[AUTH] NEXTAUTH_SECRET must be set in production — refusing to start with insecure fallback.");
  }
  if (process.env.NODE_ENV !== "production") {
    console.warn("[AUTH] NEXTAUTH_SECRET is not set — using insecure default for development only");
  }
}

const _isLocalhost = (process.env.NEXTAUTH_URL || '').includes('localhost') || !process.env.NEXTAUTH_URL;
const _useSecureCookies = process.env.NODE_ENV === 'production' && !_isLocalhost;

export const authOptions: NextAuthOptions = {
  secret: _NEXTAUTH_SECRET,

  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },

  cookies: {
    sessionToken: {
      name: _useSecureCookies
        ? "__Secure-next-auth.session-token"
        : "next-auth.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: _useSecureCookies,
        maxAge: 30 * 24 * 60 * 60, // 30 days — persists across browser restarts
      },
    },
    callbackUrl: {
      name: _useSecureCookies
        ? "__Secure-next-auth.callback-url"
        : "next-auth.callback-url",
      options: {
        sameSite: "lax",
        path: "/",
        secure: _useSecureCookies,
        maxAge: 30 * 24 * 60 * 60,
      },
    },
    csrfToken: {
      name: _useSecureCookies
        ? "__Secure-next-auth.csrf-token"
        : "next-auth.csrf-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: _useSecureCookies,
      },
    },
  },

  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const email = credentials.email.trim().toLowerCase();

        // ── Brute-force protection ──────────────────────────────────
        const ipAddress =
          (req as any)?.headers?.get?.("x-forwarded-for")?.split(",")[0]?.trim() ||
          (req as any)?.headers?.get?.("x-real-ip") ||
          "unknown";
        const emailKey = `login:${email}`;
        const ipKey = `login:${ipAddress}`;

        const [emailLimit, ipLimit] = await Promise.all([
          rateLimitByKey(emailKey, { windowMs: 15 * 60 * 1000, maxRequests: 10 }),
          rateLimitByKey(ipKey, { windowMs: 15 * 60 * 1000, maxRequests: 20 }),
        ]);

        if (!emailLimit.allowed || !ipLimit.allowed) {
          throw new Error("RATE_LIMIT_EXCEEDED");
        }

        const user = await prisma.user.findUnique({
          where: { email },
        });

        if (!user || !user.passwordHash) {
          return null;
        }

        // Prevent soft-deleted users from logging in
        if (user.deletedAt) {
          return null;
        }

        if (!user.emailVerified) {
          throw new Error("EMAIL_NOT_VERIFIED");
        }

        const isValid = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!isValid) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
        };
      },
    }),
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [GoogleProvider({
          clientId: process.env.GOOGLE_CLIENT_ID!,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        })]
      : []),
    // TODO: Azure AD provider — env vars (AZURE_AD_CLIENT_ID, AZURE_AD_CLIENT_SECRET,
    // AZURE_AD_TENANT_ID) are configured in docker-compose.yml but the provider
    // is not yet implemented. Add AzureADProvider when ready.
  ],

  callbacks: {
    async jwt({ token, user, trigger, account }) {
      // `user` is only available on sign-in; persist id and tokenVersion into token.
      if (user) {
        token.id = user.id;
        // Fetch tokenVersion and role from DB at sign-in
        const dbUser = await prisma.user.findUnique({
          where: { id: user.id },
          select: { tokenVersion: true, role: true },
        });
        token.tokenVersion = dbUser?.tokenVersion ?? 0;
        token.role = dbUser?.role;
      }
      // For OAuth sign-in, create/link user if not exists.
      // Uses create + catch(P2002) to handle race conditions atomically:
      //   - New user: create succeeds → grant trial credit
      //   - Race condition (two tabs): second create fails with P2002 → find existing → no double credit
      //   - Existing unverified: create fails → updateMany claims verification atomically → grant credit
      //   - Existing verified: create fails → emailVerified already set → no credit
      if (account && account.provider !== "credentials" && user) {
        const trialEndsAt = new Date();
        trialEndsAt.setDate(trialEndsAt.getDate() + 30);

        try {
          // Try to create — succeeds only for genuinely new users
          const newUser = await prisma.user.create({
            data: {
              email: user.email!,
              name: user.name || null,
              emailVerified: new Date(),
              trialEndsAt,
            },
            select: { id: true, tokenVersion: true },
          });
          // Create succeeded → new user → grant 1 trial credit
          await addCreditBatch(newUser.id, 1, "trial");
          token.id = newUser.id;
          token.tokenVersion = newUser.tokenVersion;

          // Send admin notification about new OAuth registration
          try {
            await sendEmail({
              to: "info@verifa.sk",
              subject: `[Verifa.sk] Nová registrácia — ${user.email} (OAuth: ${account.provider})`,
              text:
                `Nový používateľ sa zaregistroval cez ${account.provider}.\n\n` +
                `E-mail: ${user.email}\n` +
                `Meno: ${user.name || "—"}\n` +
                `ID: ${newUser.id}\n` +
                `Čas: ${new Date().toISOString()}\n\n` +
                `Účet bol automaticky overený cez OAuth.`,
              html:
                `<h2>Nová registrácia (OAuth: ${account.provider})</h2>` +
                `<p><strong>E-mail:</strong> ${escapeHtml(user.email!)}</p>` +
                `<p><strong>Meno:</strong> ${escapeHtml(user.name || "—")}</p>` +
                `<p><strong>ID:</strong> ${escapeHtml(newUser.id)}</p>` +
                `<p><strong>Čas:</strong> ${escapeHtml(new Date().toISOString())}</p>` +
                `<p style="color: #52525b;">Účet bol automaticky overený cez OAuth.</p>`,
            });
          } catch (emailErr) {
            console.error("[auth] Failed to send admin OAuth registration notification", emailErr);
          }
        } catch (createErr: any) {
          // P2002 = unique constraint violation (user already exists)
          if (createErr?.code !== "P2002") throw createErr;

          const existingUser = await prisma.user.findUnique({
            where: { email: user.email! },
            select: { id: true, tokenVersion: true, emailVerified: true, deletedAt: true },
          });
          if (!existingUser || existingUser.deletedAt) throw createErr;

          // For existing unverified users, atomically claim verification.
          // updateMany with where: { emailVerified: null } ensures only one
          // concurrent request can set it — preventing double trial credits.
          if (!existingUser.emailVerified) {
            const claimResult = await prisma.user.updateMany({
              where: { id: existingUser.id, emailVerified: null },
              data: { emailVerified: new Date() },
            });
            if (claimResult.count > 0) {
              await addCreditBatch(existingUser.id, 1, "trial");
            }
          }

          token.id = existingUser.id;
          token.tokenVersion = existingUser.tokenVersion;
        }
      }
      // Verify user still exists — but only every 5 minutes, not on every request.
      // This prevents excessive DB queries during navigation and reduces the chance
      // of accidental logout when the DB is temporarily busy (e.g., report processing).
      const now = Date.now();
      const shouldVerify = !token.lastVerified || (now - token.lastVerified) > JWT_VERIFY_INTERVAL_MS;
      if (token.id && shouldVerify) {
        token.lastVerified = now;
        try {
          const dbUser = await prisma.user.findUnique({
            where: { id: token.id },
            select: { id: true, tokenVersion: true, role: true, deletedAt: true },
          });
          if (!dbUser || dbUser.deletedAt || dbUser.tokenVersion !== token.tokenVersion) {
            token.id = "";
          }
          token.role = dbUser?.role;
        } catch {
          // DB error — keep existing token, don't logout
        }
      }
      return token;
    },

    async session({ session, token }) {
      // Expose id and role in the session object.
      // If token was invalidated (id cleared), return null session —
      // NextAuth treats null session as "not authenticated".
      if (session.user && token.id) {
        session.user.id = token.id;
        session.user.role = token.role as string | undefined;
      } else {
        // Invalidated token — clear user data so session is treated as unauthenticated
        return null as unknown as typeof session;
      }
      return session;
    },
  },

  pages: {
    signIn: "/login",
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Wrapper around getServerSession that injects authOptions automatically.
 * Use in Server Components:  const session = await getServerSession();
 */
export async function getServerSession() {
  return nextAuthGetServerSession(authOptions);
}

/**
 * Auth check for App Router route handlers.
 * Returns the authenticated user or null.
 *
 * @example
 * const user = await getCurrentUser(req);
 * if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
 */
export async function getCurrentUser(_req: NextRequest): Promise<AuthUser | null> {
  const session = await nextAuthGetServerSession(authOptions);
  if (!session?.user?.id) return null;
  return session.user as AuthUser;
}

/**
 * Timing-safe string comparison.
 * Returns true if both strings are equal, false otherwise.
 * Prevents timing side-channel attacks on secret comparisons.
 */
function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verify the x-worker-secret header using a timing-safe comparison.
 * Use this for worker-to-frontend callback endpoints (refund, notify, etc.)
 * to prevent timing attacks on the shared secret.
 *
 * @returns true if the secret matches, false otherwise.
 */
export function verifyWorkerSecret(headerValue: string | null): boolean {
  const expected = process.env.WORKER_SECRET;
  if (!expected || !headerValue) return false;
  return timingSafeEqualString(headerValue, expected);
}

/**
 * Verify a Bearer token from the Authorization header using a timing-safe
 * comparison. Use this for cron endpoint authentication.
 *
 * @returns true if the token matches, false otherwise.
 */
export function verifyCronSecret(authHeader: string | null): boolean {
  const expected = process.env.CRON_SECRET;
  // Reject empty or too-short secrets — prevents unauthenticated access if env var is unset
  if (!expected || expected.length < 16 || !authHeader) return false;

  const prefix = "Bearer ";
  if (!authHeader.startsWith(prefix)) return false;

  return timingSafeEqualString(authHeader.slice(prefix.length), expected);
}

/**
 * Admin authorization check for API route handlers.
 * Returns the authenticated admin user or a NextResponse error.
 *
 * Usage:
 *   const [admin, error] = await requireAdmin(req);
 *   if (error) return error;
 *   // admin is guaranteed to be an ADMIN user
 *
 *   Note: TypeScript narrows the type — when error is null, adminUser is non-null.
 *
 * @returns [user, null] on success, [null, NextResponse] on failure
 */
export type AdminResult = [AuthUser, null] | [null, NextResponse];

export async function requireAdmin(
  _req: NextRequest
): Promise<AdminResult> {
  const user = await getCurrentUser(_req);
  if (!user) {
    return [null, NextResponse.json({ error: "Unauthorized" }, { status: 401 })];
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { role: true },
  });

  if (!dbUser || dbUser.role !== "ADMIN") {
    return [null, NextResponse.json({ error: "Forbidden" }, { status: 403 })];
  }

  return [user, null];
}
