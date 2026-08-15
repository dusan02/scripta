import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
async function main() {
  const [total, ruzActive, withFinancials, stmts] = await Promise.all([
    p.company.count(),
    p.company.count({ where: { status: "ruz_active" } }),
    p.company.count({ where: { latestYear: { not: null } } }),
    p.financialStatement.count(),
  ]);
  console.log("LOCAL DB STATUS:");
  console.log("  Total companies:", total);
  console.log("  ruz_active:", ruzActive);
  console.log("  latestYear filled:", withFinancials);
  console.log("  FinancialStatements:", stmts);
  await p.$disconnect();
}
main().catch(console.error);
