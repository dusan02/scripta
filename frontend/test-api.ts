import { PrismaClient, SourceType } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findFirst();
  if (!user) return console.log("No user");
  
  const sources = ["ORSR", "ZRSR", "RPVS", "INSOLVENCY"] as SourceType[];
  const totalCost = 0;
  const wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
  if (!wallet) return console.log("No wallet");

  try {
    const result = await prisma.$transaction(async (tx) => {
      const updatedWallet = await tx.wallet.updateMany({
        where: { id: wallet.id, version: wallet.version },
        data: { balance: { decrement: totalCost }, version: { increment: 1 } },
      });
      if (updatedWallet.count === 0) throw new Error("Concurrent wallet update conflict");

      const reportRequest = await tx.reportRequest.create({
        data: {
          userId: user.id,
          targetType: "COMPANY",
          ico: "35757442",
          selectedSources: sources,
          totalCost: totalCost,
          status: "PENDING",
          sources: {
            create: sources.map((s) => ({
              sourceType: s,
              status: "PENDING",
              costCredits: s === "CRE" ? 5 : 0,
            })),
          },
        },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          amount: -totalCost,
          type: "CHARGE",
          status: "COMPLETED",
          reportRequestId: reportRequest.id,
          description: `Report ${reportRequest.id} charge`,
        },
      });
      return reportRequest;
    });
    console.log("Success:", result.id);
  } catch (e) {
    console.error("Caught error:", e);
  } finally {
    await prisma.$disconnect();
  }
}
main();
