import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendEmail, emailShell, emailButton } from "@/lib/email";
import { verifyWorkerSecret } from "@/lib/auth";
import { escapeHtml } from "@/lib/sanitize";
import { NEXTAUTH_URL } from "@/lib/env";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: reportId } = await params;

  if (!verifyWorkerSecret(req.headers.get("x-worker-secret"))) {
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
    const reportUrl = `${NEXTAUTH_URL}/reports/${report.id}`;

    revalidatePath("/dashboard");
    revalidatePath("/history");
    revalidatePath(`/reports/${report.id}`);

    await sendEmail({
      to: user.email,
      subject: `Report ${statusLabel.toLowerCase()} — ${companyName} | Verifa.sk`,
      text: `Dobrý deň ${user.name || ""},\n\nVáš report pre ${companyName} bol ${statusLabel.toLowerCase()}.\n\nZobraziť report: ${reportUrl}\n\nS pozdravom,\nTím Verifa.sk`,
      html: emailShell(`
        <h2>Report ${statusLabel}</h2>
        <p>Dobrý deň ${escapeHtml(user.name || "")},</p>
        <p>Váš Business Risk Report pre <strong>${escapeHtml(companyName)}</strong> bol ${statusLabel.toLowerCase()}.</p>
        <p>${emailButton(reportUrl, "Zobraziť report")}</p>
        ${report.status === "FAILED" ? '<p style="color: #dc2626; font-size: 14px;">Pri generovaní reportu nastala chyba. Skúste to prosím znova alebo nás kontaktujte na info@verifa.sk.</p>' : ""}
      `),
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
