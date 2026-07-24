"use client";

export default function ErrorAlert({ message }: { message: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "8px",
        padding: "12px",
        borderRadius: "8px",
        fontSize: "13px",
        marginBottom: "24px",
        background: "var(--danger-bg)",
        border: "1px solid var(--danger)",
        color: "var(--danger)",
      }}
      role="alert"
    >
      <svg style={{ width: "16px", height: "16px", flexShrink: 0, marginTop: "2px" }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
      </svg>
      <span>{message}</span>
    </div>
  );
}
