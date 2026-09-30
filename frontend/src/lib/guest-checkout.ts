import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { consumeCreditsTx, refundCredits } from "@/lib/credits";
import { enqueueReportTask, checkWorkerHealth } from "@/lib/worker";
import { SOURCE_IDS } from "@/lib/sources";
import { hashToken } from "@/lib/token";
import { emailShell, emailButton } from "@/lib/email";
import { escapeHtml } from "@/lib/sanitize";
import { NEXTAUTH_URL } from "@/lib/env";
import { randomUUID } from "crypto";

export type PendingEmail = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export interface GuestResolution {
  userId: string;
  email: string;
  ico: string;
  companyName: string | null;
  isNewUser: boolean;
  /** true only for the first webhook delivery that claimed the record —
   *  duplicate deliveries return shouldCreateReport=false (idempotency). */
  shouldCreateReport: boolean;
}

const DEFAULT_ATTACHMENTS = {
  obchodny_register: true,
  zivnostensky_register: true,
  auditorska_sprava: false,
  "uctovna_zavierka_a_poznámky": false,
};

/**
 * Claim a GuestCheckout (PENDING → FULFILLING, atomic) and resolve the
 * recipient user — find by email, or create a verified account with no
 * password (the set-password link in the welcome email is the activation).
 * Returns null only when the checkout record does not exist.
 */
export async function resolveGuestUser(
  guestCheckoutId: string,
  transactionId: string,
  paddleEmail?: string
): Promise<GuestResolution | null> {
  const claimed = await prisma.guestCheckout.updateMany({
    where: { id: guestCheckoutId, status: "PENDING" },
    data: { status: "FULFILLING", transactionId },
  });

  const gc = await prisma.guestCheckout.findUnique({ where: { id: guestCheckoutId } });
  if (!gc) {
    console.error(`[guest-checkout] GuestCheckout ${guestCheckoutId} not found`);
    return null;
  }

  if (claimed.count === 0) {
    // Already claimed by a concurrent/previous webhook delivery — return the
    // resolved userId so the generic (idempotent) credit grant can still run.
    if (!gc.userId) return null;
    return {
      userId: gc.userId,
      email: gc.email,
      ico: gc.ico,
      companyName: gc.companyName,
      isNewUser: false,
      shouldCreateReport: false,
    };
  }

  // We own fulfillment — find or create the user account. Prefer the email
  // Paddle collected at payment over the one typed into our form.
  const email = (paddleEmail || gc.email).toLowerCase().trim();
  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing?.deletedAt) {
    // Soft-deleted account — credits cannot be safely attached. Leave the
    // record in FULFILLING and alert admin via the caller's email queue.
    console.error(`[guest-checkout] Email belongs to soft-deleted user: ${email} (checkout ${gc.id})`);
    await prisma.guestCheckout.update({
      where: { id: gc.id },
      data: { status: "FAILED" },
    });
    return null;
  }

  const isNewUser = !existing;
  const user =
    existing ??
    (await prisma.user.create({
      data: {
        email,
        emailVerified: new Date(), // activated via the set-password link we email
      },
    }));

  await prisma.guestCheckout.update({
    where: { id: gc.id },
    data: { userId: user.id },
  });

  return {
    userId: user.id,
    email,
    ico: gc.ico,
    companyName: gc.companyName,
    isNewUser,
    shouldCreateReport: true,
  };
}

/**
 * Create the paid report for a guest purchase: consume 1 credit, create the
 * ReportRequest, enqueue the worker. On enqueue failure the credit is
 * refunded to the (new) account so the customer can retry after login —
 * mirrors POST /api/reports semantics.
 */
export async function createGuestReport(
  guestCheckoutId: string,
  userId: string,
  ico: string,
  companyName: string | null
): Promise<{ ok: boolean; reportRequestId?: string }> {
  const sources = [...SOURCE_IDS] as any[];
  const reportId = randomUUID();

  const reportRequest = await prisma
    .$transaction(async (tx) => {
      const creditResult = await consumeCreditsTx(tx, userId, 1, reportId);
      if (!creditResult.ok) throw new Error("CREDIT_CONSUMPTION_FAILED");
      return tx.reportRequest.create({
        data: {
          id: reportId,
          userId,
          targetType: "COMPANY",
          ico,
          companyName,
          selectedSources: sources,
          status: "PENDING",
          attachmentsConfig: DEFAULT_ATTACHMENTS,
          sources: {
            create: sources.map((source) => ({ sourceType: source, status: "PENDING" as const })),
          },
        },
      });
    })
    .catch((err) => {
      if (err.message === "CREDIT_CONSUMPTION_FAILED") return null;
      throw err;
    });

  if (!reportRequest) {
    console.error(`[guest-checkout] Credit consumption failed for user ${userId}, checkout ${guestCheckoutId}`);
    await prisma.guestCheckout.update({
      where: { id: guestCheckoutId },
      data: { status: "FAILED" },
    });
    return { ok: false };
  }

  try {
    await enqueueReportTask({
      reportRequestId: reportRequest.id,
      targetType: "COMPANY",
      ico,
      sources,
      orsrExtractType: "CURRENT",
      crzDateFrom: null,
      rozhodnutiaDateFrom: null,
      vestnikDateFrom: null,
      reportLanguage: "sk",
      attachmentsConfig: DEFAULT_ATTACHMENTS,
    });
  } catch (workerErr) {
    console.error("[guest-checkout] Worker enqueue failed", workerErr);
    await refundCredits(userId, 1, reportRequest.id);
    await prisma.reportRequest.update({
      where: { id: reportRequest.id },
      data: { status: "FAILED" },
    });
    await prisma.guestCheckout.update({
      where: { id: guestCheckoutId },
      data: { status: "FAILED", reportRequestId: reportRequest.id },
    });
    return { ok: false, reportRequestId: reportRequest.id };
  }

  await prisma.$transaction([
    prisma.reportRequest.update({
      where: { id: reportRequest.id },
      data: { status: "PROCESSING" },
    }),
    prisma.guestCheckout.update({
      where: { id: guestCheckoutId },
      data: { status: "FULFILLED", reportRequestId: reportRequest.id, fulfilledAt: new Date() },
    }),
  ]);

  return { ok: true, reportRequestId: reportRequest.id };
}

/**
 * Build the post-purchase emails for a guest checkout. The caller queues
 * them into the webhook's fire-and-forget batch.
 *
 * New users get a set-password link (PasswordResetToken, same as
 * forgot-password). Existing users get an order confirmation. Admin gets a
 * heads-up for every order, plus an alert when fulfillment failed.
 */
export async function buildGuestEmails(opts: {
  email: string;
  isNewUser: boolean;
  ico: string;
  companyName: string | null;
  planName?: string;
  reportOk: boolean;
}): Promise<PendingEmail[]> {
  const { email, isNewUser, ico, companyName, planName, reportOk } = opts;
  const companyLabel = companyName ? `${companyName} (IČO ${ico})` : `IČO ${ico}`;
  const emails: PendingEmail[] = [];

  if (isNewUser) {
    const token = crypto.randomBytes(32).toString("hex");
    await prisma.passwordResetToken.deleteMany({ where: { email } });
    await prisma.passwordResetToken.create({
      data: {
        email,
        token: hashToken(token),
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h — payment flow, not a security reset
      },
    });
    const setPasswordUrl = `${NEXTAUTH_URL}/reset-password?token=${token}`;

    emails.push({
      to: email,
      subject: `Ďakujeme za objednávku — report ${companyLabel} sa pripravuje`,
      text:
        `Dobrý deň,\n\n` +
        `ďakujeme za objednávku Business Risk Reportu pre ${companyLabel}.\n\n` +
        `Report sa práve generuje — po dokončení vám príde e-mail s odkazom (zvyčajne do 15 minút).\n\n` +
        `Vytvorili sme vám účet na Verifa.sk. Pre prihlásenie si najprv nastavte heslo:\n${setPasswordUrl}\n\n` +
        `Odkaz platí 24 hodín.\n\n` +
        `S pozdravom,\nTím Verifa.sk`,
      html: emailShell(`
        <h2>Ďakujeme za objednávku</h2>
        <p>Dobrý deň,</p>
        <p>
          váš Business Risk Report pre <strong>${escapeHtml(companyLabel)}</strong> sa práve generuje.
          Po dokončení vám príde e-mail s odkazom (zvyčajne do 15 minút).
        </p>
        <p>
          Vytvorili sme vám účet na <strong>Verifa.sk</strong>. Pre prihlásenie si najprv nastavte heslo:
        </p>
        <p>${emailButton(setPasswordUrl, "Nastaviť heslo")}</p>
        <p style="color: #52525b; font-size: 14px;">Odkaz je platný 24 hodín.</p>
      `),
    });
  } else {
    const loginUrl = `${NEXTAUTH_URL}/login`;
    emails.push({
      to: email,
      subject: `Objednávka prijatá — report ${companyLabel} sa pripravuje`,
      text:
        `Dobrý deň,\n\n` +
        `prijali sme vašu objednávku Business Risk Reportu pre ${companyLabel}.\n\n` +
        `Report sa práve generuje — po dokončení vám príde e-mail s odkazom.\n\n` +
        `Objednávku sme priradili k vášmu existujúcemu účtu. Prihlásenie: ${loginUrl}\n\n` +
        `S pozdravom,\nTím Verifa.sk`,
      html: emailShell(`
        <h2>Objednávka prijatá</h2>
        <p>Dobrý deň,</p>
        <p>
          váš Business Risk Report pre <strong>${escapeHtml(companyLabel)}</strong> sa práve generuje.
          Po dokončení vám príde e-mail s odkazom.
        </p>
        <p>Objednávku sme priradili k vášmu existujúcemu účtu.</p>
        <p>${emailButton(loginUrl, "Prihlásiť sa")}</p>
      `),
    });
  }

  emails.push({
    to: "info@verifa.sk",
    subject: `[Verifa.sk] ${reportOk ? "Nová guest objednávka" : "GUEST OBJEDNÁVKA ZLYHALA"} — ${companyLabel}`,
    text:
      `Guest checkout ${reportOk ? "splnený" : "ZLYHAL — vyžaduje manuálny zásah"}.\n\n` +
      `E-mail: ${email}\n` +
      `IČO: ${ico}\n` +
      `Firma: ${companyName ?? "N/A"}\n` +
      `Plán: ${planName ?? "N/A"}\n` +
      `Nový účet: ${isNewUser ? "áno" : "nie"}\n`,
    html:
      `<h2>Guest checkout ${reportOk ? "— nová objednávka" : "— ZLYHAL"}</h2>` +
      `<p><strong>E-mail:</strong> ${escapeHtml(email)}</p>` +
      `<p><strong>IČO:</strong> ${escapeHtml(ico)}</p>` +
      `<p><strong>Firma:</strong> ${escapeHtml(companyName ?? "N/A")}</p>` +
      `<p><strong>Plán:</strong> ${escapeHtml(planName ?? "N/A")}</p>` +
      `<p><strong>Nový účet:</strong> ${isNewUser ? "áno" : "nie"}</p>`,
  });

  return emails;
}
