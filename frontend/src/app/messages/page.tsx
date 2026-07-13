"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/LanguageProvider";

interface Message {
  id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

const TYPE_LABELS: Record<string, string> = {
  ANNOUNCEMENT: "messages.novinka",
  REPLY: "messages.odpoved",
  SYSTEM: "messages.system",
};

const TYPE_COLORS: Record<string, string> = {
  ANNOUNCEMENT: "var(--accent)",
  REPLY: "var(--info-text)",
  SYSTEM: "var(--text-muted)",
};

export default function MessagesPage() {
  const t = useT();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCompose, setShowCompose] = useState(false);
  const [composeTitle, setComposeTitle] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sentOk, setSentOk] = useState(false);

  useEffect(() => {
    fetch("/api/messages")
      .then((r) => {
        if (!r.ok) throw new Error("Not authorized");
        return r.json();
      })
      .then((data) => {
        setMessages(data.messages || []);
        // Označiť ako prečítané
        const unreadIds = (data.messages || [])
          .filter((m: Message) => !m.read)
          .map((m: Message) => m.id);
        if (unreadIds.length > 0) {
          fetch("/api/messages", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messageIds: unreadIds }),
          }).catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("sk-SK", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const sendMessage = async () => {
    if (!composeTitle.trim() || !composeBody.trim()) return;
    setSending(true);
    setSentOk(false);
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: composeTitle, message: composeBody }),
      });
      if (res.ok) {
        setComposeTitle("");
        setComposeBody("");
        setShowCompose(false);
        setSentOk(true);
        setTimeout(() => setSentOk(false), 3000);
      }
    } catch (error) {
      console.error("Failed to send message", error);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="max-w-[800px] mx-auto px-4 sm:px-6 pt-8 pb-12 animate-fade-in" style={{ minHeight: "calc(100vh - 120px)" }}>
      <div className="text-center mb-8">
        <h1
          className="text-2xl font-bold tracking-tight mb-1"
          style={{ color: "var(--text)", letterSpacing: "-0.02em" }}
        >
          {t("messages.spravy")}
        </h1>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {t("messages.popis")}
        </p>
      </div>

      {/* Compose button + success toast */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => setShowCompose(!showCompose)}
          className="px-4 py-2 rounded-lg text-sm font-semibold"
          style={{
            background: "var(--accent)",
            color: "var(--accent-button-text)",
            border: "none",
            cursor: "pointer",
          }}
        >
          {showCompose ? t("messages.zrusit") : t("messages.napisatSpravu")}
        </button>
        {sentOk && (
          <span className="text-xs font-medium" style={{ color: "var(--success)" }}>
            ✓ {t("messages.uspech")}
          </span>
        )}
      </div>

      {/* Compose form */}
      {showCompose && (
        <div className="card p-6 mb-6" style={{ border: "1px solid var(--border)" }}>
          <div className="flex flex-col gap-4">
            <div>
              <label className="text-xs block mb-1" style={{ color: "var(--text-muted)" }}>
                {t("messages.predmet")}
              </label>
              <input
                type="text"
                value={composeTitle}
                onChange={(e) => setComposeTitle(e.target.value)}
                placeholder={t("messages.predmetPlaceholder")}
                className="w-full px-3 py-2 rounded-lg text-sm border"
                style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)" }}
              />
            </div>
            <div>
              <label className="text-xs block mb-1" style={{ color: "var(--text-muted)" }}>
                {t("messages.sprava")}
              </label>
              <textarea
                value={composeBody}
                onChange={(e) => setComposeBody(e.target.value)}
                placeholder={t("messages.spravaPlaceholder")}
                rows={5}
                className="w-full px-3 py-2 rounded-lg text-sm border resize-none"
                style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)" }}
              />
            </div>
            <button
              onClick={sendMessage}
              disabled={sending || !composeTitle.trim() || !composeBody.trim()}
              className="px-4 py-2 rounded-lg text-sm font-semibold self-start"
              style={{
                background: sending ? "var(--bg-muted)" : "var(--accent)",
                color: sending ? "var(--text-muted)" : "var(--accent-button-text)",
                border: "none",
                cursor: sending ? "not-allowed" : "pointer",
              }}
            >
              {sending ? t("messages.odosiela") : t("messages.odoslat")}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div
          className="h-32 rounded-lg animate-pulse"
          style={{ background: "var(--bg-muted)" }}
        />
      ) : messages.length === 0 ?(
        <div
          className="card p-8 text-center"
          style={{ border: "1px solid var(--border)" }}
        >
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            {t("messages.ziadneSpravy")}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className="card p-4"
              style={{
                border: `1px solid ${msg.read ? "var(--border)" : "var(--accent-border)"}`,
                background: "var(--surface)",
              }}
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2">
                  <span
                    className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                    style={{
                      background: `${TYPE_COLORS[msg.type] || "var(--bg-muted)"}20`,
                      color: TYPE_COLORS[msg.type] || "var(--text-muted)",
                    }}
                  >
                    {t(TYPE_LABELS[msg.type] || msg.type)}
                  </span>
                  {!msg.read && (
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ background: "var(--accent)" }}
                    />
                  )}
                </div>
                <span
                  className="text-[10px]"
                  style={{ color: "var(--text-muted)" }}
                >
                  {formatDate(msg.createdAt)}
                </span>
              </div>
              <h3
                className="text-sm font-semibold mb-1"
                style={{ color: "var(--text)" }}
              >
                {msg.title}
              </h3>
              <p
                className="text-xs whitespace-pre-wrap"
                style={{ color: "var(--text-secondary)" }}
              >
                {msg.body}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
