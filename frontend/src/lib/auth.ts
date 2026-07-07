import { NextAuthOptions, getServerSession as nextAuthGetServerSession } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import AzureADProvider from "next-auth/providers/azure-ad";
import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { addCreditBatch } from "@/lib/credits";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AuthUser = {
  id: string;
  email: string;
  name?: string | null;
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
  }
}

const JWT_VERIFY_INTERVAL_MS = 5 * 60 * 1000; // 5 minút

// ─── Auth Options ─────────────────────────────────────────────────────────────

const _NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET;
if (!_NEXTAUTH_SECRET) {
  if (process.env.NODE_ENV === "production") {
    console.error("[AUTH] NEXTAUTH_SECRET is not set — using insecure fallback. Set NEXTAUTH_SECRET env var!");
  }
  console.warn("[AUTH] NEXTAUTH_SECRET is not set — using insecure default for development only");
}

const _isLocalhost = (process.env.NEXTAUTH_URL || '').includes('localhost');
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
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        });

        if (!user || !user.passwordHash) {
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
    ...(process.env.AZURE_AD_CLIENT_ID && process.env.AZURE_AD_CLIENT_SECRET
      ? [AzureADProvider({
          clientId: process.env.AZURE_AD_CLIENT_ID!,
          clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
          tenantId: process.env.AZURE_AD_TENANT_ID || "common",
        })]
      : []),
  ],

  callbacks: {
    async jwt({ token, user, trigger, account }) {
      // `user` is only available on sign-in; persist id and tokenVersion into token.
      if (user) {
        token.id = user.id;
        // Fetch tokenVersion from DB at sign-in
        const dbUser = await prisma.user.findUnique({
          where: { id: user.id },
          select: { tokenVersion: true },
        });
        token.tokenVersion = dbUser?.tokenVersion ?? 0;
      }
      // For OAuth sign-in, create/link user if not exists
      if (account && account.provider !== "credentials" && user) {
        const existingUser = await prisma.user.findUnique({
          where: { email: user.email! },
        });
        if (!existingUser) {
          const trialEndsAt = new Date();
          trialEndsAt.setDate(trialEndsAt.getDate() + 30);

          const newUser = await prisma.user.create({
            data: {
              email: user.email!,
              name: user.name || null,
              emailVerified: new Date(),
              trialEndsAt,
            },
          });

          // Grant 5 free trial credits via CreditBatch
          await addCreditBatch(newUser.id, 5, "trial");
        } else if (!existingUser.emailVerified) {
          await prisma.user.update({
            where: { id: existingUser.id },
            data: { emailVerified: new Date() },
          });
        }
        const dbUser = await prisma.user.findUnique({
          where: { email: user.email! },
          select: { id: true, tokenVersion: true },
        });
        if (dbUser) {
          token.id = dbUser.id;
          token.tokenVersion = dbUser.tokenVersion;
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
            select: { id: true, tokenVersion: true },
          });
          if (!dbUser || dbUser.tokenVersion !== token.tokenVersion) {
            token.id = "";
          }
        } catch {
          // DB error — keep existing token, don't logout
        }
      }
      return token;
    },

    async session({ session, token }) {
      // Expose id in the session object.
      // If token was invalidated (id cleared), session has no user.
      if (session.user && token.id) {
        session.user.id = token.id;
      } else {
        // Invalidated token — return empty session
        session.user = undefined as unknown as typeof session.user;
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
