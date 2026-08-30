import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { addCreditBatch, cancelSubscription, revokeCreditsOnRefund } from "@/lib/credits";
import { getBillingAdapter } from "@/lib/billing";
import { sendEmail, emailShell, emailButton } from "@/lib/email";
import { escapeHtml } from "@/lib/sanitize";
import { NEXTAUTH_URL } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Collect emails to send AFTER the 200 response — Stripe requires fast webhook ack.
type PendingEmail = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export async function POST(req: NextRequest) {
  const adapter = getBillingAdapter();
  const body = await req.text();

  // Signature header name varies by provider
  const signature =
    req.headers.get("stripe-signature") ||
    req.headers.get("signature") ||
    req.headers.get("paddle-signature") ||
    "";

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let events;
  try {
    events = await adapter.handleWebhook(body, signature);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[webhook] handleWebhook error:", message);
    return NextResponse.json({ error: "Invalid signature or payload" }, { status: 400 });
  }

  // Collect emails to send after responding 200 to Stripe.
  // DB operations must complete before 200 (idempotency), emails can be async.
  const pendingEmails: PendingEmail[] = [];

  try {
    for (const event of events) {
      switch (event.type) {
        case "payment.succeeded": {
          if (event.credits > 0) {
            // One-time purchases (payg1, payg10, payg50) are "addon" source.
            // Subscription plans use "subscription" source.
            const isOneTime = event.planName?.startsWith("payg") || !event.planName || event.planName === "addon";
            const source = isOneTime ? "addon" : "subscription";
            await addCreditBatch(
              event.userId,
              event.credits,
              source as "trial" | "subscription" | "addon" | "rollover",
              event.planName,
              event.providerReference,
              adapter.providerName,
              event.eventId
            );

            if (!isOneTime && event.planName) {
              // Subscription: update user plan status
              const renewalDate = event.currentPeriodEnd ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
              await prisma.user.update({
                where: { id: event.userId },
                data: {
                  planName: event.planName,
                  planRenewalDate: renewalDate,
                  subscriptionStatus: "active",
                },
              });
            }
          }
          break;
        }

        case "subscription.canceled": {
          if (event.endsAt) {
            await cancelSubscription(event.userId, event.endsAt);
          }
          break;
        }

        case "subscription.reactivated": {
          await prisma.user.update({
            where: { id: event.userId },
            data: {
              subscriptionStatus: "active",
              subscriptionEndsAt: null,
            },
          });
          break;
        }

        case "payment.failed": {
          await prisma.user.update({
            where: { id: event.userId },
            data: { subscriptionStatus: "past_due" },
          });
          break;
        }

        case "charge.refunded": {
          // Revoke credits that were granted for the refunded payment.
          if (event.credits !== 0 && event.originalProviderReference) {
            const result = await revokeCreditsOnRefund(
              event.userId,
              event.credits,
              event.providerReference,
              event.originalProviderReference,
              adapter.providerName,
              event.eventId
            );

            // If the original TOPUP hasn't been processed yet (out-of-order
            // webhook delivery), return 500 so Stripe retries the event later.
            if (result.revoked === -1) {
              console.warn(
                `[webhook] charge.refunded: original TOPUP not found for ` +
                `user ${event.userId}, ref ${event.originalProviderReference}. ` +
                `Returning 500 to trigger provider retry.`
              );
              return NextResponse.json(
                { error: "Original TOPUP not found — will retry" },
                { status: 500 }
              );
            }

            // Only queue notifications if credits were actually revoked
            // (revoked > 0 means a real deduction happened; 0 = idempotent skip).
            if (result.revoked > 0) {
              // --- Admin notification (always on chargeback) ---
              pendingEmails.push({
                to: "info@verifa.sk",
                subject: `[Verifa.sk] Chargeback/Refund — ${result.revoked} kreditov`,
                text:
                  `Zaznamenali sme vrátenie platby / chargeback.\n\n` +
                  `Používateľ ID: ${event.userId}\n` +
                  `E-mail: ${result.userEmail ?? "neznámy"}\n` +
                  `Stornovaných kreditov: ${result.revoked}\n` +
                  `Identifikátor platby: ${event.originalProviderReference}\n` +
                  `Refund ID: ${event.providerReference}\n` +
                  `Výsledný wallet.balance: ${result.newBalance}\n` +
                  `Plan: ${event.planName ?? "N/A"}`,
                html:
                  `<h2>Vrátenie platby / Chargeback</h2>` +
                  `<p><strong>Používateľ ID:</strong> ${escapeHtml(event.userId)}</p>` +
                  `<p><strong>E-mail:</strong> ${escapeHtml(result.userEmail ?? "neznámy")}</p>` +
                  `<p><strong>Stornovaných kreditov:</strong> ${result.revoked}</p>` +
                  `<p><strong>Identifikátor platby:</strong> ${escapeHtml(event.originalProviderReference)}</p>` +
                  `<p><strong>Refund ID:</strong> ${escapeHtml(event.providerReference)}</p>` +
                  `<p><strong>Výsledný wallet.balance:</strong> ${result.newBalance}</p>` +
                  `<p><strong>Plan:</strong> ${escapeHtml(event.planName ?? "N/A")}</p>`,
              });

              // --- User notification (only if wallet went negative) ---
              if (result.newBalance < 0 && result.userEmail) {
                const pricingUrl = `${NEXTAUTH_URL}/pricing`;
                pendingEmails.push({
                  to: result.userEmail,
                  subject: "Dôležité: Vrátenie platby a obmedzenie účtu",
                  text:
                    `Dobrý deň,\n\n` +
                    `Zaznamenali sme vrátenie platby (refund/chargeback) na vašom účte. ` +
                    `Z tohto dôvodu bol váš kreditový zostatok upravený a aktuálne je v zápornej hodnote (${result.newBalance} kreditov).\n\n` +
                    `Generovanie nových reportov je dočasne pozastavené. ` +
                    `Pre pokračovanie vo využívaní služieb si prosím zakúpte nový balíček kreditov v cenníku, ` +
                    `čím sa záporný zostatok automaticky dorovná.\n\n` +
                    `Cenník: ${pricingUrl}\n\n` +
                    `Ak máte otázky, kontaktujte nás na info@verifa.sk.\n\n` +
                    `S pozdravom,\nTím Verifa.sk`,
                  html: emailShell(`
                    <h2>Vrátenie platby a obmedzenie účtu</h2>
                    <p>Dobrý deň,</p>
                    <p>
                      Zaznamenali sme vrátenie platby (refund/chargeback) na vašom účte.
                      Z tohto dôvodu bol váš kreditový zostatok upravený a aktuálne je v
                      <strong>zápornej hodnote (${result.newBalance} kreditov)</strong>.
                    </p>
                    <p>
                      Generovanie nových reportov je <strong>dočasne pozastavené</strong>.
                      Pre pokračovanie vo využívaní služieb si prosím zakúpte nový balíček
                      kreditov v cenníku, čím sa záporný zostatok automaticky dorovná.
                    </p>
                    <p>${emailButton(pricingUrl, "Zakúpiť kredity")}</p>
                    <p style="color: #52525b; font-size: 14px;">
                      Ak máte otázky, kontaktujte nás na
                      <a href="mailto:info@verifa.sk" style="color: #10b981;">info@verifa.sk</a>.
                    </p>
                  `),
                });
              }
            }
          }

          // If the refund was for a subscription payment (signaled by endsAt
          // being set), cancel the subscription in our DB so the user can't
          // keep using it. Stripe cancels the subscription on its side when a
          // chargeback occurs on a subscription invoice.
          if (event.endsAt) {
            await cancelSubscription(event.userId, event.endsAt);
          }
          break;
        }
      }
    }

    // Return 200 to Stripe immediately — DB state is committed.
    // Send emails in the background (fire-and-forget, no await on response).
    if (pendingEmails.length > 0) {
      // Don't await — let emails send after the response is sent.
      // Errors are caught and logged, not propagated to Stripe.
      Promise.allSettled(
        pendingEmails.map((email) =>
          sendEmail(email).catch((err) =>
            console.error("[webhook] Failed to send email:", err)
          )
        )
      );
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Billing webhook error:", error);
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }
}
