import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const req = await prisma.reportRequest.findFirst({
    orderBy: { createdAt: 'desc' },
  })
  if (!req) return;
  console.log("Report created At:", req.createdAt)
}
main().finally(() => prisma.$disconnect())
