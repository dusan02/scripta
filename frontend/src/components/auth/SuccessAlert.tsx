import { ReactNode } from "react";

interface SuccessAlertProps {
  title: string;
  message?: string | ReactNode;
  actionLabel: string;
  actionHref: string;
}

export default function SuccessAlert({ title, message, actionLabel, actionHref }: SuccessAlertProps) {
  return (
    <div style={{ textAlign: "center", padding: "16px 0" }}>
      <div
        style={{
          width: "48px",
          height: "48px",
          borderRadius: "50%",
          background: "var(--success-bg)",
          color: "var(--success)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto 16px auto",
        }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      </div>
      <h3 style={{ fontSize: "16px", margin: "0 0 8px 0", color: "var(--text)" }}>{title}</h3>
      {message && (
        <p style={{ fontSize: "14px", color: "var(--text-muted)", margin: "0 0 24px 0", lineHeight: 1.5 }}>
          {message}
        </p>
      )}
      <a
        href={actionHref}
        className="btn-primary"
        style={{ width: "100%", padding: "10px", display: "inline-block", textDecoration: "none", boxSizing: "border-box" }}
      >
        {actionLabel}
      </a>
    </div>
  );
}
