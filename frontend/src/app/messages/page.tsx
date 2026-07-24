"use client";

import { useEffect, useState, useCallback } from "react";
import { useT, useLang } from "@/components/LanguageProvider";
import { LOCALE_MAP } from "@/lib/i18n";

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
  USER: "messages.odoslane",
};

const TYPE_COLORS: Record<string, string> = {
  ANNOUNCEMENT: "var(--accent)",
  REPLY: "var(--info-text)",
  SYSTEM: "var(--text-muted)",
  USER: "var(--success)",
};

export default function MessagesPage() {
  const t = useT();
  const { lang } = useLang();
  const locale = LOCALE_MAP[lang];
  const [messages, setMessages] = useState<Message[]>([]);
  const [sentMessages, setSentMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"inbox" | "sent">("inbox");
  const [selectedMsg, setSelectedMsg] = useState<Message | null>(null);
  const [showCompose, setShowCompose] = useState(false);
  const [composeTitle, setComposeTitle] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sentOk, setSentOk] = useState(false);
  const [replyContext, setReplyContext] = useState<Message | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackCategory, setFeedbackCategory] = useState("");
  const [feedbackRequestId, setFeedbackRequestId] = useState("");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [feedbackSending, setFeedbackSending] = useState(false);

  const FEEDBACK_CATEGORIES = [
    { value: "BUG", key: "feedback.chyba" },
    { value: "IMPROVEMENT", key: "feedback.napad" },
    { value: "QUESTION", key: "feedback.otazka" },
    { value: "OTHER", key: "feedback.ine" },
  ];

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString(locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const markAsRead = useCallback((msgs: Message[]) => {
    const unreadIds = msgs.filter((m) => !m.read).map((m) => m.id);
    if (unreadIds.length > 0) {
      fetch("/api/messages", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageIds: unreadIds }),
      }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    fetch("/api/messages", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error("Not authorized");
        return r.json();
      })
      .then((data) => {
        const msgs = data.messages || [];
        setMessages(msgs);
        markAsRead(msgs);
        setMessages(msgs.map((m: Message) => ({ ...m, read: true })));
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    fetch("/api/messages/sent", { cache: "no-store" })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setSentMessages(data.messages || []); })
      .catch(() => {});
  }, [markAsRead]);

  const refreshSent = () => {
    fetch("/api/messages/sent", { cache: "no-store" })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setSentMessages(data.messages || []); })
      .catch(() => {});
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
        setReplyContext(null);
        setSentOk(true);
        setTimeout(() => setSentOk(false), 3000);
        refreshSent();
      }
    } catch (error) {
      console.error("Failed to send message", error);
    } finally {
      setSending(false);
    }
  };

  const submitFeedback = async () => {
    if (!feedbackCategory || !feedbackMessage.trim()) return;
    setFeedbackSending(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: feedbackCategory,
          requestId: feedbackRequestId || null,
          message: feedbackMessage.trim(),
        }),
      });
      if (res.ok) {
        setFeedbackCategory("");
        setFeedbackRequestId("");
        setFeedbackMessage("");
        setShowFeedback(false);
        setSentOk(true);
        setTimeout(() => setSentOk(false), 3000);
        refreshSent();
      }
    } catch (error) {
      console.error("Failed to submit feedback", error);
    } finally {
      setFeedbackSending(false);
    }
  };

  const startReply = (msg: Message) => {
    const replyTitle = msg.title.startsWith("Re:") ? msg.title : `Re: ${msg.title}`;
    setComposeTitle(replyTitle);
    setComposeBody("");
    setReplyContext(msg);
    setSelectedMsg(null);
    setShowCompose(true);
  };

  const openMessage = (msg: Message) => {
    setSelectedMsg(msg);
  };

  const currentList = tab === "inbox" ? messages : sentMessages;

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

      {/* Success toast */}
      {sentOk && (
        <div
          className="mb-4 px-4 py-3 rounded-lg text-sm font-medium text-center"
          style={{ background: "var(--success-light, rgba(34,197,94,0.1))", color: "var(--success)", border: "1px solid var(--success)" }}
        >
          ✓ {t("messages.uspech")}
        </div>
      )}

      {/* Message Detail View */}
      {selectedMsg ? (
        <div className="card p-6 mb-6" style={{ border: "1px solid var(--border)" }}>
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => setSelectedMsg(null)}
              className="text-sm font-medium flex items-center gap-1"
              style={{ color: "var(--text-secondary)", cursor: "pointer", background: "none", border: "none" }}
            >
              ← {t("messages.späť")}
            </button>
            <span
              className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
              style={{
                background: `${TYPE_COLORS[selectedMsg.type] || "var(--bg-muted)"}20`,
                color: TYPE_COLORS[selectedMsg.type] || "var(--text-muted)",
              }}
            >
              {t(TYPE_LABELS[selectedMsg.type] || selectedMsg.type)}
            </span>
          </div>

          <h2 className="text-lg font-bold mb-2" style={{ color: "var(--text)" }}>
            {selectedMsg.title}
          </h2>
          <span className="text-xs block mb-4" style={{ color: "var(--text-muted)" }}>
            {formatDate(selectedMsg.createdAt)}
          </span>

          <div
            className="text-sm whitespace-pre-wrap mb-6"
            style={{ color: "var(--text-secondary)", lineHeight: 1.6 }}
          >
            {selectedMsg.body}
          </div>

          {tab === "inbox" && selectedMsg.type !== "USER" && (
            <button
              onClick={() => startReply(selectedMsg)}
              className="px-4 py-2 rounded-lg text-sm font-semibold"
              style={{
                background: "var(--accent)",
                color: "var(--accent-button-text)",
                border: "none",
                cursor: "pointer",
              }}
            >
              ↩ {t("messages.odpovedat")}
            </button>
          )}
        </div>

      ) : showFeedback ? (
        /* Feedback / Report Form */
        <div className="card p-6 mb-6" style={{ border: "1px solid var(--border)" }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold" style={{ color: "var(--text)" }}>
              {t("feedback.titulok")}
            </h2>
            <button
              onClick={() => { setShowFeedback(false); setFeedbackCategory(""); setFeedbackRequestId(""); setFeedbackMessage(""); }}
              className="text-sm"
              style={{ color: "var(--text-muted)", cursor: "pointer", background: "none", border: "none" }}
            >
              ✕
            </button>
          </div>

          <div className="flex flex-col gap-4">
            <div>
              <label className="text-xs block mb-1" style={{ color: "var(--text-muted)" }}>
                {t("feedback.predmet")} <span style={{ color: "var(--danger)" }}>*</span>
              </label>
              <select
                value={feedbackCategory}
                onChange={(e) => setFeedbackCategory(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm"
                style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }}
              >
                <option value="">{t("feedback.vyberteKategoriu")}</option>
                {FEEDBACK_CATEGORIES.map((cat) => (
                  <option key={cat.value} value={cat.value}>{t(cat.key)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs block mb-1" style={{ color: "var(--text-muted)" }}>
                {t("feedback.idRequestu")} <span style={{ color: "var(--text-muted)" }}>(nepovinné)</span>
              </label>
              <input
                type="text"
                value={feedbackRequestId}
                onChange={(e) => setFeedbackRequestId(e.target.value)}
                placeholder="napr. clxxxxx"
                className="w-full px-3 py-2 rounded-lg text-sm"
                style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }}
              />
            </div>
            <div>
              <label className="text-xs block mb-1" style={{ color: "var(--text-muted)" }}>
                {t("feedback.text")} <span style={{ color: "var(--danger)" }}>*</span>
              </label>
              <textarea
                value={feedbackMessage}
                onChange={(e) => setFeedbackMessage(e.target.value)}
                rows={5}
                placeholder={t("feedback.popiste")}
                className="w-full px-3 py-2 rounded-lg text-sm border resize-none"
                style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)" }}
              />
            </div>
            <button
              onClick={submitFeedback}
              disabled={feedbackSending || !feedbackCategory || !feedbackMessage.trim()}
              className="px-4 py-2 rounded-lg text-sm font-semibold self-start"
              style={{
                background: feedbackSending ? "var(--bg-muted)" : "var(--accent)",
                color: feedbackSending ? "var(--text-muted)" : "var(--accent-button-text)",
                border: "none",
                cursor: feedbackSending ? "not-allowed" : "pointer",
                opacity: !feedbackCategory || !feedbackMessage.trim() ? 0.6 : 1,
              }}
            >
              {feedbackSending ? t("feedback.odosielam") : t("feedback.odoslat")}
            </button>
          </div>
        </div>

      ) : showCompose ? (
        /* Compose / Reply Form */
        <div className="card p-6 mb-6" style={{ border: "1px solid var(--border)" }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold" style={{ color: "var(--text)" }}>
              {replyContext ? t("messages.odpovedat") : t("messages.napisatSpravu")}
            </h2>
            <button
              onClick={() => { setShowCompose(false); setReplyContext(null); setComposeTitle(""); setComposeBody(""); }}
              className="text-sm"
              style={{ color: "var(--text-muted)", cursor: "pointer", background: "none", border: "none" }}
            >
              ✕
            </button>
          </div>

          {/* Reply context preview */}
          {replyContext && (
            <div
              className="mb-4 p-3 rounded-lg text-xs"
              style={{ background: "var(--bg-muted)", border: "1px solid var(--border)" }}
            >
              <div className="font-semibold mb-1" style={{ color: "var(--text-secondary)" }}>
                {replyContext.title}
              </div>
              <div
                className="whitespace-pre-wrap"
                style={{ color: "var(--text-muted)", maxHeight: "100px", overflow: "hidden" }}
              >
                {replyContext.body}
              </div>
            </div>
          )}

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
                rows={6}
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

      ) : (
        /* List View */
        <>
          {/* Compose + Report buttons */}
          <div className="flex items-center gap-2 mb-4">
            <button
              onClick={() => { setComposeTitle(""); setComposeBody(""); setReplyContext(null); setShowCompose(true); }}
              className="px-4 py-2 rounded-lg text-sm font-semibold"
              style={{
                background: "var(--accent)",
                color: "var(--accent-button-text)",
                border: "none",
                cursor: "pointer",
              }}
            >
              {t("messages.napisatSpravu")}
            </button>
            <button
              onClick={() => setShowFeedback(true)}
              className="px-4 py-2 rounded-lg text-sm font-semibold"
              style={{
                background: "var(--surface)",
                color: "var(--text-secondary)",
                border: "1px solid var(--border)",
                cursor: "pointer",
              }}
            >
              {t("feedback.titulok")}
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setTab("inbox")}
              className="px-4 py-2 rounded-lg text-sm font-medium"
              style={{
                background: tab === "inbox" ? "var(--accent)" : "var(--surface)",
                color: tab === "inbox" ? "var(--accent-button-text)" : "var(--text-secondary)",
                border: tab === "inbox" ? "none" : "1px solid var(--border)",
                cursor: "pointer",
              }}
            >
              {t("messages.prijate")}
            </button>
            <button
              onClick={() => setTab("sent")}
              className="px-4 py-2 rounded-lg text-sm font-medium"
              style={{
                background: tab === "sent" ? "var(--accent)" : "var(--surface)",
                color: tab === "sent" ? "var(--accent-button-text)" : "var(--text-secondary)",
                border: tab === "sent" ? "none" : "1px solid var(--border)",
                cursor: "pointer",
              }}
            >
              {t("messages.odoslane")}
            </button>
          </div>

          {loading ? (
            <div className="h-32 rounded-lg animate-pulse" style={{ background: "var(--bg-muted)" }} />
          ) : currentList.length === 0 ? (
            <div className="card p-8 text-center" style={{ border: "1px solid var(--border)" }}>
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                {t("messages.ziadneSpravy")}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {currentList.map((msg) => (
                <div
                  key={msg.id}
                  onClick={() => openMessage(msg)}
                  className="card p-4 cursor-pointer transition-all duration-150 hover:shadow-md"
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
                        <span className="w-2 h-2 rounded-full" style={{ background: "var(--accent)" }} />
                      )}
                    </div>
                    <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                      {formatDate(msg.createdAt)}
                    </span>
                  </div>
                  <h3 className="text-sm font-semibold mb-1" style={{ color: "var(--text)" }}>
                    {msg.title}
                  </h3>
                  <p
                    className="text-xs"
                    style={{
                      color: "var(--text-secondary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {msg.body}
                  </p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
