import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendEmail, emailButtonStyle } from "@/lib/email";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: reportId } = await params;

  const authHeader = req.headers.get("x-worker-secret");
  if (authHeader !== process.env.WORKER_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const report = await prisma.reportRequest.findUnique({
      where: { id: reportId },
      select: {
        id: true,
        status: true,
        companyName: true,
        ico: true,
        userId: true,
        targetType: true,
        completedAt: true,
      },
    });

    if (!report) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    const user = await prisma.user.findUnique({
      where: { id: report.userId },
      select: { email: true, name: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const statusLabel =
      report.status === "COMPLETED"
        ? "Dokončený"
        : report.status === "PARTIAL"
        ? "Čiastočne dokončený"
        : "Zlyhaný";

    const companyName = report.companyName || report.ico || "Neznámy subjekt";
    const reportUrl = `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/reports/${report.id}`;

    await sendEmail({
      to: user.email,
      subject: `Report ${statusLabel.toLowerCase()} — ${companyName} | Verifa.sk`,
      text: `Dobrý deň ${user.name || ""},\n\nVáš report pre ${companyName} bol ${statusLabel.toLowerCase()}.\n\nZobraziť report: ${reportUrl}\n\nS pozdravom,\nTím Verifa.sk`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #09090b;">
          <h2>Report ${statusLabel}</h2>
          <p>Dobrý deň ${user.name || ""},</p>
          <p>Váš due diligence report pre <strong>${companyName}</strong> bol ${statusLabel.toLowerCase()}.</p>
          <p>
            <a href="${reportUrl}" style="${emailButtonStyle()}">Zobraziť report</a>
          </p>
          ${report.status === "FAILED" ? '<p style="color: #dc2626; font-size: 14px;">Pri generovaní reportu nastala chyba. Skúste to prosím znova alebo nás kontaktujte na info@verifa.sk.</p>' : ""}
          <hr style="border: none; border-top: 1px solid #e4e4e7; margin: 24px 0;">
          <p style="color: #a1a1aa; font-size: 12px;">Verifa.sk — Komplexný due diligence report zo štátnych registrov SR.</p>
        </div>
      `,
    });

    return NextResponse.json({ sent: true });
  } catch (error) {
    console.error("Notify email error:", error);
    return NextResponse.json(
      { error: "Failed to send notification" },
      { status: 500 }
    );
  }
}
