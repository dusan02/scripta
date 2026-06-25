import { NextAuthOptions, getServerSession as nextAuthGetServerSession } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

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
  }
}

// ─── Auth Options ─────────────────────────────────────────────────────────────

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,

  session: {
    strategy: "jwt",
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
  ],

  callbacks: {
    async jwt({ token, user, trigger }) {
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
      // Verify user still exists (catches stale tokens after DB reset)
      // Only on sign-in or update — not every request (perf)
      if (user || trigger === "update") {
        if (token.id) {
          const dbUser = await prisma.user.findUnique({
            where: { id: token.id },
            select: { id: true, tokenVersion: true },
          });
          if (!dbUser) {
            token.id = "";
          } else if (dbUser.tokenVersion !== token.tokenVersion) {
            token.id = "";
          }
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
