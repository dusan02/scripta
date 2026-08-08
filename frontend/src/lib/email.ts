import { prisma } from "@/lib/prisma";
import { emailShell, emailButton, emailButtonStyle } from "@/lib/emailTemplates";

export { emailShell, emailButton, emailButtonStyle };

/**
 * Generate a reply-to address that encodes the userId for inbound email routing.
 * When admin replies from their email client, Resend forwards to /api/email/inbound
 * which extracts the userId and creates a REPLY message in the user's inbox.
 */
export function getReplyToAddress(userId: string): string {
  const inboundDomain = process.env.INBOUND_EMAIL_DOMAIN || "inbound.resend.app";
  return `reply+${userId}@${inboundDomain}`;
}

type SendEmailParams = {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
};

export async function sendEmail({ to, subject, text, html, replyTo }: SendEmailParams): Promise<void> {
  const resendApiKey = process.env.RESEND_API_KEY;

  if (!resendApiKey) {
    console.log("============================================");
    console.log("MOCK EMAIL SENDING (Missing RESEND_API_KEY):");
    console.log("To:", to);
    console.log("Subject:", subject);
    console.log("Text:", text.substring(0, 200));
    console.log("============================================");
    return;
  }

  // Check if recipient email is bounced/complained — skip sending to protect sender reputation
  const normalizedEmail = to.toLowerCase().trim();
  try {
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { emailBounced: true, emailComplained: true },
    });
    if (user?.emailBounced) {
      console.warn(`[email] Skipping send to ${normalizedEmail} — email bounced`);
      return;
    }
    if (user?.emailComplained) {
      console.warn(`[email] Skipping send to ${normalizedEmail} — user complained (spam)`);
      return;
    }
  } catch {
    // DB error — continue sending (fail open, don't block emails on DB issues)
  }

  const from = process.env.EMAIL_FROM || "Verifa.sk <noreply@verifa.sk>";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, text, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend error ${res.status}: ${err}`);
  }
}
