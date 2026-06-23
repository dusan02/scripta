import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱  Seeding development database...");

  const email = "test@registro.sk";
  const password = "heslo123";
  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash },
    create: {
      email,
      name: "Test Lawyer",
      passwordHash,
      role: "LAWYER",
      wallet: {
        create: {
          balance: 100, // Starting balance of 100 credits for development
          currency: "EUR",
        },
      },
    },
    include: { wallet: true },
  });

  console.log(`✅  User created/updated: ${user.email} (id: ${user.id})`);
  console.log(`   Wallet balance: ${user.wallet?.balance ?? "N/A"} credits`);
  console.log(`\n   Login credentials:`);
  console.log(`   Email:    ${email}`);
  console.log(`   Password: ${password}`);
}

main()
  .catch((e) => {
    console.error("❌  Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
