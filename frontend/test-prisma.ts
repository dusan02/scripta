import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  console.log("Checking DB connection and schema...");
  const user = await prisma.user.findFirst();
  if (!user) return console.log("No user");
  console.log("User:", user.id);
  
  try {
    const report = await prisma.reportRequest.create({
      data: {
        userId: user.id,
        targetType: "COMPANY",
        ico: "31322832",
        status: "PENDING",
        selectedSources: ["RPVS"],
        totalCost: 0,
        sources: {
          create: [{
            sourceType: "RPVS",
            status: "PENDING",
            costCredits: 0
          }]
        }
      }
    });
    console.log("Success! Created report", report.id);
  } catch (e) {
    console.error("Prisma error:", e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
