import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const req = await prisma.reportRequest.findFirst({
    orderBy: { createdAt: 'desc' }
  })
  if (req) {
    console.log(req.id, req.createdAt, req.selectedSources.includes("ZRSR"))
  }
}
main().finally(() => prisma.$disconnect())
