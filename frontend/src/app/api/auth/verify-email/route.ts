import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/token";
import { addCreditBatch } from "@/lib/credits";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.json({ message: "Chýba verifikačný token." }, { status: 400 });
  }

  const hashedToken = hashToken(token);

  const verificationRecord = await prisma.verificationToken.findUnique({
    where: { token: hashedToken },
  });

  if (!verificationRecord) {
    return NextResponse.json({ message: "Neplatný verifikačný token." }, { status: 400 });
  }

  if (verificationRecord.expires < new Date()) {
    await prisma.verificationToken.delete({ where: { id: verificationRecord.id } });
    return NextResponse.json({ message: "Verifikačný token expiroval. Zaregistrujte sa znova." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { email: verificationRecord.email },
  });

  if (!user) {
    return NextResponse.json({ message: "Používateľ neexistuje." }, { status: 400 });
  }

  if (user.emailVerified) {
    await prisma.verificationToken.delete({ where: { id: verificationRecord.id } });
    return NextResponse.json({ message: "Účet je už aktivovaný." });
  }

  const trialEndsAt = new Date();
  trialEndsAt.setDate(trialEndsAt.getDate() + 30);

  await prisma.user.update({
    where: { email: verificationRecord.email },
    data: { emailVerified: new Date(), trialEndsAt },
  });

  // Create wallet with 1 free trial credit via CreditBatch
  await addCreditBatch(user.id, 1, "trial");

  await prisma.verificationToken.delete({ where: { id: verificationRecord.id } });

  return NextResponse.json({ message: "Účet bol úspešne aktivovaný. Môžete sa prihlásiť." });
}
