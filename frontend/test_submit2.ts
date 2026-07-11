import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const user = await prisma.user.findUnique({ where: { email: 'test@verifa.sk' } })
  console.log(user?.defaultSources?.length)
}
main().finally(() => prisma.$disconnect())
