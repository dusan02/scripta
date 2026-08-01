import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱  Seeding development database...");

  // ── Primary test user ──────────────────────────────────────────────
  const email = "test@verifa.sk";
  const password = "heslo123";
  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, emailVerified: new Date() },
    create: {
      email,
      name: "Test Lawyer",
      passwordHash,
      role: "LAWYER",
      emailVerified: new Date(),
    },
  });

  // Ensure the primary test user has a wallet with credits for E2E tests.
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + 60);
  let wallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
  if (!wallet) {
    wallet = await prisma.wallet.create({
      data: { userId: user.id, balance: 10, currency: "EUR" },
    });
    await prisma.creditBatch.create({
      data: {
        userId: user.id,
        amount: 10,
        remaining: 10,
        source: "addon",
        expiresAt: expiry,
      },
    });
    await prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        amount: 10,
        type: "TOPUP",
        status: "COMPLETED",
        description: "Seed credits for E2E testing",
      },
    });
  }

  console.log(`✅  User created/updated: ${user.email} (id: ${user.id})`);

  // ── E2E test user A ────────────────────────────────────────────────
  const e2eEmailA = "e2e-test@verifa.sk";
  const e2ePasswordA = "E2eTestPass123!";
  const e2eHashA = await bcrypt.hash(e2ePasswordA, 12);

  const e2eUserA = await prisma.user.upsert({
    where: { email: e2eEmailA },
    update: { passwordHash: e2eHashA, emailVerified: new Date() },
    create: {
      email: e2eEmailA,
      name: "E2E Test User A",
      passwordHash: e2eHashA,
      role: "LAWYER",
      emailVerified: new Date(),
    },
  });

  // Wallet with credits for E2E user A
  let e2eWalletA = await prisma.wallet.findUnique({ where: { userId: e2eUserA.id } });
  if (!e2eWalletA) {
    e2eWalletA = await prisma.wallet.create({
      data: { userId: e2eUserA.id, balance: 5, currency: "EUR" },
    });
    await prisma.creditBatch.create({
      data: {
        userId: e2eUserA.id,
        amount: 5,
        remaining: 5,
        source: "addon",
        expiresAt: expiry,
      },
    });
    await prisma.walletTransaction.create({
      data: {
        walletId: e2eWalletA.id,
        amount: 5,
        type: "TOPUP",
        status: "COMPLETED",
        description: "E2E test credits (User A)",
      },
    });
  }

  console.log(`✅  E2E User A: ${e2eUserA.email} (id: ${e2eUserA.id})`);

  // ── E2E test user B (for IDOR tests — should NOT access A's reports) ──
  const e2eEmailB = "e2e-test-b@verifa.sk";
  const e2ePasswordB = "E2eTestPass456!";
  const e2eHashB = await bcrypt.hash(e2ePasswordB, 12);

  const e2eUserB = await prisma.user.upsert({
    where: { email: e2eEmailB },
    update: { passwordHash: e2eHashB, emailVerified: new Date() },
    create: {
      email: e2eEmailB,
      name: "E2E Test User B",
      passwordHash: e2eHashB,
      role: "LAWYER",
      emailVerified: new Date(),
    },
  });

  // Wallet with credits for E2E user B
  let e2eWalletB = await prisma.wallet.findUnique({ where: { userId: e2eUserB.id } });
  if (!e2eWalletB) {
    e2eWalletB = await prisma.wallet.create({
      data: { userId: e2eUserB.id, balance: 5, currency: "EUR" },
    });
    await prisma.creditBatch.create({
      data: {
        userId: e2eUserB.id,
        amount: 5,
        remaining: 5,
        source: "addon",
        expiresAt: expiry,
      },
    });
    await prisma.walletTransaction.create({
      data: {
        walletId: e2eWalletB.id,
        amount: 5,
        type: "TOPUP",
        status: "COMPLETED",
        description: "E2E test credits (User B)",
      },
    });
  }

  console.log(`✅  E2E User B: ${e2eUserB.email} (id: ${e2eUserB.id})`);

  console.log(`\n   Login credentials:`);
  console.log(`   Primary:  ${email} / ${password}`);
  console.log(`   E2E A:    ${e2eEmailA} / ${e2ePasswordA}`);
  console.log(`   E2E B:    ${e2eEmailB} / ${e2ePasswordB}`);
}

main()
  .catch((e) => {
    console.error("❌  Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
