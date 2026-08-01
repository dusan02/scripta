import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { addCreditBatch, cancelSubscription, revokeCreditsOnRefund } from "@/lib/credits";
import { getBillingAdapter } from "@/lib/billing";
import { sendEmail, emailButtonStyle } from "@/lib/email";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
    if (message.includes("Paddle")) {
      return NextResponse.json({ error: message }, { status: 501 });
    }
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    for (const event of events) {
      switch (event.type) {
        case "payment.succeeded": {
          if (event.credits > 0) {
            const source = event.planName === "addon" ? "addon" : "subscription";
            await addCreditBatch(
              event.userId,
              event.credits,
              source,
              event.planName,
              event.providerReference,
              adapter.providerName
            );

            if (event.planName && event.planName !== "addon") {
              const renewalDate = new Date();
              renewalDate.setDate(renewalDate.getDate() + 30);
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
              adapter.providerName
            );

            // If the original TOPUP hasn't been processed yet (out-of-order
            // webhook delivery), return 500 so Stripe retries the event later.
            if (result.revoked === -1) {
              console.warn(
                `[webhook] charge.refunded: original TOPUP not found for ` +
                `user ${event.userId}, ref ${event.originalProviderReference}. ` +
                `Returning 500 to trigger Stripe retry.`
              );
              return NextResponse.json(
                { error: "Original TOPUP not found — will retry" },
                { status: 500 }
              );
            }

            // Only send notifications if credits were actually revoked
            // (revoked > 0 means a real deduction happened; 0 = idempotent skip).
            if (result.revoked > 0) {
              // --- Admin notification (always on chargeback) ---
              try {
                await sendEmail({
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
                    `<p><strong>Používateľ ID:</strong> ${event.userId}</p>` +
                    `<p><strong>E-mail:</strong> ${result.userEmail ?? "neznámy"}</p>` +
                    `<p><strong>Stornovaných kreditov:</strong> ${result.revoked}</p>` +
                    `<p><strong>Identifikátor platby:</strong> ${event.originalProviderReference}</p>` +
                    `<p><strong>Refund ID:</strong> ${event.providerReference}</p>` +
                    `<p><strong>Výsledný wallet.balance:</strong> ${result.newBalance}</p>` +
                    `<p><strong>Plan:</strong> ${event.planName ?? "N/A"}</p>`,
                });
              } catch (emailErr) {
                console.error("[webhook] Failed to send admin chargeback email", emailErr);
              }

              // --- User notification (only if wallet went negative) ---
              if (result.newBalance < 0 && result.userEmail) {
                try {
                  const pricingUrl = `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/pricing`;
                  await sendEmail({
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
                    html: `
                      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #09090b;">
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
                        <p>
                          <a href="${pricingUrl}" style="${emailButtonStyle()}">Zakúpiť kredity</a>
                        </p>
                        <p style="color: #52525b; font-size: 14px;">
                          Ak máte otázky, kontaktujte nás na
                          <a href="mailto:info@verifa.sk" style="color: #10b981;">info@verifa.sk</a>.
                        </p>
                        <hr style="border: none; border-top: 1px solid #e4e4e7; margin: 24px 0;">
                        <p style="color: #a1a1aa; font-size: 12px;">Verifa.sk — Business Risk Report zo štátnych registrov SR.</p>
                      </div>
                    `,
                  });
                } catch (emailErr) {
                  console.error("[webhook] Failed to send user chargeback email", emailErr);
                }
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

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Billing webhook error:", error);
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }
}
