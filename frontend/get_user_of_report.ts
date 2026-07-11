import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const req = await prisma.reportRequest.findUnique({
    where: { id: 'cmrcdsicz005o8bw4zl3x6rvo' },
    include: { user: true }
  })
  if (!req) return
  console.log("Report User Email:", req.user.email)
  console.log("Report User defaultSources length:", req.user.defaultSources ? req.user.defaultSources.length : 'null')
  if (req.user.defaultSources && Array.isArray(req.user.defaultSources)) {
    console.log("Has ZRSR?", req.user.defaultSources.includes("ZRSR"))
  }
}
main().finally(() => prisma.$disconnect())
