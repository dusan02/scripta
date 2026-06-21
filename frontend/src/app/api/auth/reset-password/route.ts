import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { z } from "zod";

const resetPasswordSchema = z.object({
  token: z.string().min(1, "Token je povinný."),
  password: z.string().min(8, "Nové heslo musí mať aspoň 8 znakov."),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const result = resetPasswordSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { message: result.error.errors[0].message },
        { status: 400 }
      );
    }

    const { token, password } = result.data;

    const resetTokenRecord = await prisma.passwordResetToken.findUnique({
      where: { token },
    });

    if (!resetTokenRecord) {
      return NextResponse.json(
        { message: "Neplatný alebo expirovaný odkaz na obnovu hesla." },
        { status: 400 }
      );
    }

    // Check expiration
    if (new Date() > resetTokenRecord.expires) {
      // Delete expired token to keep DB clean
      await prisma.passwordResetToken.delete({
        where: { id: resetTokenRecord.id },
      });
      return NextResponse.json(
        { message: "Tento odkaz už vypršal. Požiadajte o obnovu hesla znova." },
        { status: 400 }
      );
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Update user and delete token in a transaction
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { email: resetTokenRecord.email },
        data: { passwordHash },
      });

      await tx.passwordResetToken.delete({
        where: { id: resetTokenRecord.id },
      });
    });

    return NextResponse.json({ message: "Heslo bolo úspešne zmenené." });
  } catch (error) {
    console.error("Reset password error:", error);
    return NextResponse.json(
      { message: "Nastala neočakávaná chyba pri obnove hesla." },
      { status: 500 }
    );
  }
}
