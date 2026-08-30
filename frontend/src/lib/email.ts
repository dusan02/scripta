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
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend error ${res.status}: ${err}`);
  }
}

/**
 * Batch send emails via Resend's /emails/batch endpoint.
 * Sends up to 100 emails per API call (Resend limit).
 * Filters out bounced/complained recipients in a single DB query.
 */
export async function sendEmailBatch(emails: SendEmailParams[]): Promise<number> {
  if (emails.length === 0) return 0;

  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    console.log(`[email] MOCK BATCH: would send ${emails.length} emails`);
    return emails.length;
  }

  // Batch-check bounced/complained in a single query
  const emailAddresses = emails.map(e => e.to.toLowerCase().trim());
  const blockedUsers = await prisma.user.findMany({
    where: {
      email: { in: emailAddresses },
      OR: [{ emailBounced: true }, { emailComplained: true }],
    },
    select: { email: true, emailBounced: true, emailComplained: true },
  });
  const blockedSet = new Set(blockedUsers.map(u => u.email));

  const filtered = emails.filter(e => {
    const normalized = e.to.toLowerCase().trim();
    if (blockedSet.has(normalized)) {
      console.warn(`[email] Skipping ${normalized} — bounced/complained`);
      return false;
    }
    return true;
  });

  if (filtered.length === 0) return 0;

  const from = process.env.EMAIL_FROM || "Verifa.sk <noreply@verifa.sk>";
  let sent = 0;

  // Resend batch limit is 100 per call
  for (let i = 0; i < filtered.length; i += 100) {
    const chunk = filtered.slice(i, i + 100);
    const payload = chunk.map(e => ({
      from,
      to: e.to,
      subject: e.subject,
      text: e.text,
      html: e.html,
      ...(e.replyTo ? { reply_to: e.replyTo } : {}),
    }));

    try {
      const res = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000),
      });

      if (!res.ok) {
        const err = await res.text();
        console.error(`[email] Batch send error ${res.status}: ${err}`);
      } else {
        sent += chunk.length;
      }
    } catch (err) {
      console.error("[email] Batch send failed:", err);
    }
  }

  return sent;
}
