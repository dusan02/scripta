"use client";

import { useState } from "react";

const CATEGORIES = [
  { value: "BUG", label: "Chyba" },
  { value: "IMPROVEMENT", label: "Nápad na zlepšenie" },
  { value: "QUESTION", label: "Otázka" },
  { value: "OTHER", label: "Iné" },
];

export default function FeedbackModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [category, setCategory] = useState("");
  const [requestId, setRequestId] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!category || !message.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          requestId: requestId || null,
          message: message.trim(),
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Odoslanie zlyhalo");
      }
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        setCategory("");
        setRequestId("");
        setMessage("");
        onClose();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Neznáma chyba");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl p-6"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2
            className="text-base font-bold"
            style={{ color: "var(--text)" }}
          >
            Nahlásiť / Spätná väzba
          </h2>
          <button
            onClick={onClose}
            className="text-sm"
            style={{ color: "var(--text-muted)" }}
          >
            ✕
          </button>
        </div>

        {success ? (
          <div
            className="text-center py-8"
            style={{ color: "var(--success-text)" }}
          >
            <div className="text-2xl mb-2">✓</div>
            <p className="text-sm font-medium">Ďakujeme! Správa bola odoslaná.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label
                className="block text-xs font-medium mb-1.5"
                style={{ color: "var(--text-secondary)" }}
              >
                Predmet <span style={{ color: "var(--danger)" }}>*</span>
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                required
                className="w-full px-3 py-2 rounded-lg text-sm"
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                }}
              >
                <option value="">Vyberte kategóriu...</option>
                {CATEGORIES.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                className="block text-xs font-medium mb-1.5"
                style={{ color: "var(--text-secondary)" }}
              >
                ID requestu <span style={{ color: "var(--text-muted)" }}>(nepovinné)</span>
              </label>
              <input
                type="text"
                value={requestId}
                onChange={(e) => setRequestId(e.target.value)}
                placeholder="napr. clxxxxx"
                className="w-full px-3 py-2 rounded-lg text-sm"
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                }}
              />
            </div>

            <div>
              <label
                className="block text-xs font-medium mb-1.5"
                style={{ color: "var(--text-secondary)" }}
              >
                Text <span style={{ color: "var(--danger)" }}>*</span>
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                required
                rows={4}
                placeholder="Popíšte nám problém, nápad alebo otázku..."
                className="w-full px-3 py-2 rounded-lg text-sm resize-none"
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                }}
              />
            </div>

            {error && (
              <p className="text-xs" style={{ color: "var(--danger)" }}>
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting || !category || !message.trim()}
              className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all"
              style={{
                background: "var(--accent)",
                color: "white",
                border: "none",
                cursor: submitting ? "not-allowed" : "pointer",
                opacity: submitting || !category || !message.trim() ? 0.6 : 1,
              }}
            >
              {submitting ? "Odosielam..." : "Odoslať"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
