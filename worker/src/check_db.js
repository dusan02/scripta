require('dotenv').config({ path: '../.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const company = await prisma.company.findUnique({
        where: { ico: "51078856" },
        include: { sources: true }
    });
    if (!company) { console.log("Company not found"); return; }
    for (const s of company.sources) {
        if (s.sourceType === "FS_DANOVE_SUBJEKTY") {
            console.log(s.findings);
        }
    }
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
