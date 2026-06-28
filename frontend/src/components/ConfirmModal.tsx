"use client";

import { useEffect } from "react";
import { formatCompanyName } from "@/lib/format";

interface ConfirmModalProps {
  open: boolean;
  title: string;
  subject?: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export default function ConfirmModal({
  open,
  title,
  subject,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  loading = false,
}: ConfirmModalProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
    };
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.4)" }}
      onClick={onCancel}
    >
      <div
        className="rounded-2xl p-6 max-w-sm w-full fade-in"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          boxShadow: "var(--shadow-md)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-4">
          <div
            className="flex items-center justify-center rounded-full flex-shrink-0"
            style={{ width: 40, height: 40, background: "var(--danger-bg)" }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ color: "var(--danger)" }}>
              <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
              {title}
            </h3>
            {subject && (
              <div className="mt-0.5">
                {formatCompanyName(subject).map((line, i) => (
                  <p key={i} className="text-xs" style={{ color: i > 0 ? "var(--danger-text)" : "var(--text-muted)" }}>
                    {line}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
        <p className="text-xs mb-5" style={{ color: "var(--text-secondary)" }}>
          {message}
        </p>
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-xs font-medium transition-all"
            style={{ background: "var(--bg-muted)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="px-4 py-2 rounded-lg text-xs font-medium transition-all flex items-center gap-2"
            style={{ background: "var(--danger)", color: "var(--accent-button-text)", border: "none" }}
          >
            {loading && (
              <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                <path d="M12 2a10 10 0 010 20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            )}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
