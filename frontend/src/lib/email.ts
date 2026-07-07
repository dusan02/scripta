import nodemailer from "nodemailer";

type SendEmailParams = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export async function sendEmail({ to, subject, text, html }: SendEmailParams): Promise<void> {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
    console.log("============================================");
    console.log("MOCK EMAIL SENDING (Missing SMTP variables):");
    console.log("To:", to);
    console.log("Subject:", subject);
    console.log("Text:", text.substring(0, 200));
    console.log("============================================");
    return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from: process.env.EMAIL_FROM || '"Verifa.sk" <noreply@verifa.sk>',
    to,
    subject,
    text,
    html,
  });
}

export function emailButtonStyle(): string {
  return "display: inline-block; background-color: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; margin-top: 8px;";
}
