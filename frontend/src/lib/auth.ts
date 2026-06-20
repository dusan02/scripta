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

        // Ensure the user has a Wallet — create atomically if missing.
        const existingWallet = await prisma.wallet.findUnique({
          where: { userId: user.id },
        });

        if (!existingWallet) {
          await prisma.wallet.create({
            data: { userId: user.id },
          });
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
    async jwt({ token, user }) {
      // `user` is only available on sign-in; persist id into token.
      if (user) {
        token.id = user.id;
      }
      return token;
    },

    async session({ session, token }) {
      // Expose id in the session object.
      if (session.user) {
        session.user.id = token.id;
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
