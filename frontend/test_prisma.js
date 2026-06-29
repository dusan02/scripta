const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const req = await prisma.reportRequest.findUnique({ where: { id: 'cmqyz577a00bl24crjrgs8vyg' }});
  console.log('aiStatus:', req.aiStatus);
  await prisma.$disconnect();
}
main();
