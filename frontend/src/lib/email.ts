type SendEmailParams = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export async function sendEmail({ to, subject, text, html }: SendEmailParams): Promise<void> {
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

  const from = process.env.EMAIL_FROM || "Verifa.sk <noreply@verifa.sk>";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, text, html }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend error ${res.status}: ${err}`);
  }
}

export function emailButtonStyle(): string {
  return "display: inline-block; background-color: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; margin-top: 8px;";
}
