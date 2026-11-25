import { PrismaClient } from "@prisma/client";
import { buildPrismaDatasourceUrl } from "@/lib/prisma-pool";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient(): PrismaClient {
  const datasourceUrl = buildPrismaDatasourceUrl(process.env.DATABASE_URL);
  return new PrismaClient({
    ...(datasourceUrl ? { datasources: { db: { url: datasourceUrl } } } : {}),
    log: ["error"],
  });
}

// Cache singleton on globalThis in all environments (including production) so
// Next.js standalone route chunks never instantiate duplicate connection pools.
export const prisma = globalForPrisma.prisma ?? createPrismaClient();
globalForPrisma.prisma = prisma;
