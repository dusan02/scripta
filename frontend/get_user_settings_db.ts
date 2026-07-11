import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const users = await prisma.user.findMany({
    select: { email: true, defaultSources: true }
  })
  for (const u of users) {
    console.log(`User ${u.email} defaultSources length:`, u.defaultSources ? u.defaultSources.length : 'null')
    if (u.defaultSources && Array.isArray(u.defaultSources)) {
      console.log(`  Has ZRSR?`, u.defaultSources.includes("ZRSR"))
    }
  }
}
main().finally(() => prisma.$disconnect())
