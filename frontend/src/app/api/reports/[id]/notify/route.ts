import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendEmail, emailShell, emailButton } from "@/lib/email";
import { verifyWorkerSecret } from "@/lib/auth";
import { escapeHtml } from "@/lib/sanitize";
import { NEXTAUTH_URL } from "@/lib/env";
import { revalidatePath } from "next/cache";
import { translate, normalizeLang } from "@/lib/i18n";

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
      select: { email: true, name: true, reportLanguage: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const lang = normalizeLang(user.reportLanguage);
    const statusKey =
      report.status === "COMPLETED"
        ? "email.reportDokonceny"
        : report.status === "PARTIAL"
        ? "email.reportCiastocne"
        : "email.reportZlyhany";
    const statusLabel = translate(lang, statusKey);

    const companyName = report.companyName || report.ico || translate(lang, "email.reportNeznamy");
    const reportUrl = `${NEXTAUTH_URL}/reports/${report.id}`;

    revalidatePath("/dashboard");
    revalidatePath("/history");
    revalidatePath(`/reports/${report.id}`);

    const subject = translate(lang, "email.reportSubject", { status: statusLabel, company: companyName });
    const greeting = translate(lang, "email.dobryDen");
    const bodyText = translate(lang, "email.reportBodyText", { company: companyName, status: statusLabel });
    const bodyHtml = translate(lang, "email.reportBodyHtml", { company: escapeHtml(companyName), status: statusLabel });
    const viewBtn = translate(lang, "email.reportZobrazit");
    const heading = translate(lang, "email.reportHeading", { status: statusLabel });
    const regards = translate(lang, "email.sPozdravom");
    const team = translate(lang, "email.timVerifa");
    const errorText = report.status === "FAILED" ? translate(lang, "email.reportChyba") : "";

    await sendEmail({
      to: user.email,
      subject,
      text: `${greeting} ${user.name || ""},\n\n${bodyText}\n\n${viewBtn}: ${reportUrl}\n\n${regards},\n${team}`,
      html: emailShell(`
        <h2>${escapeHtml(heading)}</h2>
        <p>${greeting} ${escapeHtml(user.name || "")},</p>
        <p>${bodyHtml}</p>
        <p>${emailButton(reportUrl, viewBtn)}</p>
        ${errorText ? `<p style="color: #dc2626; font-size: 14px;">${escapeHtml(errorText)}</p>` : ""}
      `, lang),
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
