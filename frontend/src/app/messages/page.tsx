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

const FEEDBACK_CATEGORIES = [
  { value: "BUG", key: "feedback.chyba" },
  { value: "IMPROVEMENT", key: "feedback.napad" },
  { value: "QUESTION", key: "feedback.otazka" },
  { value: "OTHER", key: "feedback.ine" },
];

const styles = {
  card: { border: "1px solid var(--border)" } as React.CSSProperties,
  input: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    color: "var(--text)",
  } as React.CSSProperties,
  textarea: {
    background: "var(--surface)",
    borderColor: "var(--border)",
    color: "var(--text)",
  } as React.CSSProperties,
  label: {
    color: "var(--text-muted)",
  } as React.CSSProperties,
  closeBtn: {
    color: "var(--text-muted)",
    cursor: "pointer",
    background: "none",
    border: "none",
  } as React.CSSProperties,
  primaryBtn: (disabled: boolean) => ({
    background: disabled ? "var(--bg-muted)" : "var(--accent)",
    color: disabled ? "var(--text-muted)" : "var(--accent-button-text)",
    border: "none",
    cursor: disabled ? "not-allowed" : "pointer",
  }) as React.CSSProperties,
  tabBtn: (active: boolean) => ({
    background: active ? "var(--accent)" : "var(--surface)",
    color: active ? "var(--accent-button-text)" : "var(--text-secondary)",
    border: active ? "none" : "1px solid var(--border)",
    cursor: "pointer",
  }) as React.CSSProperties,
  typeBadge: (type: string) => ({
    background: `${TYPE_COLORS[type] || "var(--bg-muted)"}20`,
    color: TYPE_COLORS[type] || "var(--text-muted)",
  }) as React.CSSProperties,
};

function useDateFormat(locale: string) {
  return (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString(locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };
}

export default function MessagesPage() {
  const t = useT();
  const { lang } = useLang();
  const locale = LOCALE_MAP[lang];
  const formatDate = useDateFormat(locale);

  const [messages, setMessages] = useState<Message[]>([]);
  const [sentMessages, setSentMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"inbox" | "sent">("inbox");
  const [selectedMsg, setSelectedMsg] = useState<Message | null>(null);
  const [showCompose, setShowCompose] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [composeTitle, setComposeTitle] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sentOk, setSentOk] = useState(false);
  const [replyContext, setReplyContext] = useState<Message | null>(null);
  const [feedbackCategory, setFeedbackCategory] = useState("");
  const [feedbackRequestId, setFeedbackRequestId] = useState("");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [feedbackSending, setFeedbackSending] = useState(false);

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
        markAsRead(msgs);
        setMessages(msgs.map((m: Message) => ({ ...m, read: true })));
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    refreshSent();
  }, [markAsRead]);

  const refreshSent = useCallback(() => {
    fetch("/api/messages/sent", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) setSentMessages(data.messages || []); })
      .catch(() => {});
  }, []);

  const showSuccess = () => {
    setSentOk(true);
    setTimeout(() => setSentOk(false), 3000);
  };

  const sendMessage = async () => {
    if (!composeTitle.trim() || !composeBody.trim()) return;
    setSending(true);
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
        showSuccess();
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
        resetFeedback();
        showSuccess();
        refreshSent();
      }
    } catch (error) {
      console.error("Failed to submit feedback", error);
    } finally {
      setFeedbackSending(false);
    }
  };

  const resetFeedback = () => {
    setFeedbackCategory("");
    setFeedbackRequestId("");
    setFeedbackMessage("");
    setShowFeedback(false);
  };

  const resetCompose = () => {
    setShowCompose(false);
    setReplyContext(null);
    setComposeTitle("");
    setComposeBody("");
  };

  const startReply = (msg: Message) => {
    const replyTitle = msg.title.startsWith("Re:") ? msg.title : `Re: ${msg.title}`;
    setComposeTitle(replyTitle);
    setComposeBody("");
    setReplyContext(msg);
    setSelectedMsg(null);
    setShowCompose(true);
  };

  const currentList = tab === "inbox" ? messages : sentMessages;

  return (
    <div className="max-w-[800px] mx-auto px-4 sm:px-6 pt-8 pb-12 animate-fade-in" style={{ minHeight: "calc(100vh - 120px)" }}>
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold tracking-tight mb-1" style={{ color: "var(--text)", letterSpacing: "-0.02em" }}>
          {t("messages.spravy")}
        </h1>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {t("messages.popis")}
        </p>
      </div>

      {sentOk && (
        <div className="mb-4 px-4 py-3 rounded-lg text-sm font-medium text-center"
          style={{ background: "var(--success-light, rgba(34,197,94,0.1))", color: "var(--success)", border: "1px solid var(--success)" }}>
          ✓ {t("messages.uspech")}
        </div>
      )}

      {selectedMsg ? (
        <MessageDetail msg={selectedMsg} t={t} formatDate={formatDate} onBack={() => setSelectedMsg(null)}
          onReply={() => startReply(selectedMsg)} showReply={tab === "inbox" && selectedMsg.type !== "USER"} />
      ) : showFeedback ? (
        <FeedbackForm t={t} category={feedbackCategory} setCategory={setFeedbackCategory}
          requestId={feedbackRequestId} setRequestId={setFeedbackRequestId}
          message={feedbackMessage} setMessage={setFeedbackMessage}
          sending={feedbackSending} onSubmit={submitFeedback} onClose={resetFeedback} />
      ) : showCompose ? (
        <ComposeForm t={t} title={composeTitle} setTitle={setComposeTitle}
          body={composeBody} setBody={setComposeBody}
          sending={sending} onSubmit={sendMessage} onClose={resetCompose}
          replyContext={replyContext} />
      ) : (
        <MessageList t={t} loading={loading} messages={currentList} tab={tab} setTab={setTab}
          formatDate={formatDate} onOpen={(msg) => setSelectedMsg(msg)}
          onCompose={() => { resetCompose(); setShowCompose(true); }}
          onFeedback={() => setShowFeedback(true)} />
      )}
    </div>
  );
}

function MessageDetail({ msg, t, formatDate, onBack, onReply, showReply }: {
  msg: Message;
  t: (k: string) => string;
  formatDate: (iso: string) => string;
  onBack: () => void;
  onReply: () => void;
  showReply: boolean;
}) {
  return (
    <div className="card p-6 mb-6" style={styles.card}>
      <div className="flex items-center justify-between mb-4">
        <button onClick={onBack} className="text-sm font-medium flex items-center gap-1"
          style={{ color: "var(--text-secondary)", cursor: "pointer", background: "none", border: "none" }}>
          ← {t("messages.späť")}
        </button>
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={styles.typeBadge(msg.type)}>
          {t(TYPE_LABELS[msg.type] || msg.type)}
        </span>
      </div>
      <h2 className="text-lg font-bold mb-2" style={{ color: "var(--text)" }}>{msg.title}</h2>
      <span className="text-xs block mb-4" style={{ color: "var(--text-muted)" }}>{formatDate(msg.createdAt)}</span>
      <div className="text-sm whitespace-pre-wrap mb-6" style={{ color: "var(--text-secondary)", lineHeight: 1.6 }}>
        {msg.body}
      </div>
      {showReply && (
        <button onClick={onReply} className="px-4 py-2 rounded-lg text-sm font-semibold" style={styles.primaryBtn(false)}>
          ↩ {t("messages.odpovedat")}
        </button>
      )}
    </div>
  );
}

function ComposeForm({ t, title, setTitle, body, setBody, sending, onSubmit, onClose, replyContext }: {
  t: (k: string) => string;
  title: string; setTitle: (v: string) => void;
  body: string; setBody: (v: string) => void;
  sending: boolean; onSubmit: () => void; onClose: () => void;
  replyContext: Message | null;
}) {
  return (
    <div className="card p-6 mb-6" style={styles.card}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-bold" style={{ color: "var(--text)" }}>
          {replyContext ? t("messages.odpovedat") : t("messages.napisatSpravu")}
        </h2>
        <button onClick={onClose} className="text-sm" style={styles.closeBtn}>✕</button>
      </div>
      {replyContext && (
        <div className="mb-4 p-3 rounded-lg text-xs" style={{ background: "var(--bg-muted)", border: "1px solid var(--border)" }}>
          <div className="font-semibold mb-1" style={{ color: "var(--text-secondary)" }}>{replyContext.title}</div>
          <div className="whitespace-pre-wrap" style={{ color: "var(--text-muted)", maxHeight: "100px", overflow: "hidden" }}>
            {replyContext.body}
          </div>
        </div>
      )}
      <div className="flex flex-col gap-4">
        <div>
          <label className="text-xs block mb-1" style={styles.label}>{t("messages.predmet")}</label>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder={t("messages.predmetPlaceholder")}
            className="w-full px-3 py-2 rounded-lg text-sm border" style={styles.input} />
        </div>
        <div>
          <label className="text-xs block mb-1" style={styles.label}>{t("messages.sprava")}</label>
          <textarea value={body} onChange={(e) => setBody(e.target.value)}
            placeholder={t("messages.spravaPlaceholder")} rows={6}
            className="w-full px-3 py-2 rounded-lg text-sm border resize-none" style={styles.textarea} />
        </div>
        <button onClick={onSubmit} disabled={sending || !title.trim() || !body.trim()}
          className="px-4 py-2 rounded-lg text-sm font-semibold self-start"
          style={styles.primaryBtn(sending)}>
          {sending ? t("messages.odosiela") : t("messages.odoslat")}
        </button>
      </div>
    </div>
  );
}

function FeedbackForm({ t, category, setCategory, requestId, setRequestId, message, setMessage, sending, onSubmit, onClose }: {
  t: (k: string) => string;
  category: string; setCategory: (v: string) => void;
  requestId: string; setRequestId: (v: string) => void;
  message: string; setMessage: (v: string) => void;
  sending: boolean; onSubmit: () => void; onClose: () => void;
}) {
  const disabled = sending || !category || !message.trim();
  return (
    <div className="card p-6 mb-6" style={styles.card}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-bold" style={{ color: "var(--text)" }}>{t("feedback.titulok")}</h2>
        <button onClick={onClose} className="text-sm" style={styles.closeBtn}>✕</button>
      </div>
      <div className="flex flex-col gap-4">
        <div>
          <label className="text-xs block mb-1" style={styles.label}>
            {t("feedback.predmet")} <span style={{ color: "var(--danger)" }}>*</span>
          </label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-sm" style={styles.input}>
            <option value="">{t("feedback.vyberteKategoriu")}</option>
            {FEEDBACK_CATEGORIES.map((cat) => (
              <option key={cat.value} value={cat.value}>{t(cat.key)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs block mb-1" style={styles.label}>
            {t("feedback.idRequestu")} <span style={{ color: "var(--text-muted)" }}>(nepovinné)</span>
          </label>
          <input type="text" value={requestId} onChange={(e) => setRequestId(e.target.value)}
            placeholder="napr. clxxxxx" className="w-full px-3 py-2 rounded-lg text-sm" style={styles.input} />
        </div>
        <div>
          <label className="text-xs block mb-1" style={styles.label}>
            {t("feedback.text")} <span style={{ color: "var(--danger)" }}>*</span>
          </label>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5}
            placeholder={t("feedback.popiste")}
            className="w-full px-3 py-2 rounded-lg text-sm border resize-none" style={styles.textarea} />
        </div>
        <button onClick={onSubmit} disabled={disabled}
          className="px-4 py-2 rounded-lg text-sm font-semibold self-start"
          style={{ ...styles.primaryBtn(sending), opacity: disabled ? 0.6 : 1 }}>
          {sending ? t("feedback.odosielam") : t("feedback.odoslat")}
        </button>
      </div>
    </div>
  );
}

function MessageList({ t, loading, messages, tab, setTab, formatDate, onOpen, onCompose, onFeedback }: {
  t: (k: string) => string;
  loading: boolean;
  messages: Message[];
  tab: "inbox" | "sent";
  setTab: (t: "inbox" | "sent") => void;
  formatDate: (iso: string) => string;
  onOpen: (msg: Message) => void;
  onCompose: () => void;
  onFeedback: () => void;
}) {
  return (
    <>
      <div className="flex items-center gap-2 mb-4">
        <button onClick={onCompose} className="px-4 py-2 rounded-lg text-sm font-semibold"
          style={styles.primaryBtn(false)}>
          {t("messages.napisatSpravu")}
        </button>
        <button onClick={onFeedback} className="px-4 py-2 rounded-lg text-sm font-semibold"
          style={{ background: "var(--surface)", color: "var(--text-secondary)", border: "1px solid var(--border)", cursor: "pointer" }}>
          {t("feedback.titulok")}
        </button>
      </div>

      <div className="flex gap-2 mb-4">
        <button onClick={() => setTab("inbox")} className="px-4 py-2 rounded-lg text-sm font-medium" style={styles.tabBtn(tab === "inbox")}>
          {t("messages.prijate")}
        </button>
        <button onClick={() => setTab("sent")} className="px-4 py-2 rounded-lg text-sm font-medium" style={styles.tabBtn(tab === "sent")}>
          {t("messages.odoslane")}
        </button>
      </div>

      {loading ? (
        <div className="h-32 rounded-lg animate-pulse" style={{ background: "var(--bg-muted)" }} />
      ) : messages.length === 0 ? (
        <div className="card p-8 text-center" style={styles.card}>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>{t("messages.ziadneSpravy")}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {messages.map((msg) => (
            <div key={msg.id} onClick={() => onOpen(msg)}
              className="card p-4 cursor-pointer transition-all duration-150 hover:shadow-md"
              style={{ border: `1px solid ${msg.read ? "var(--border)" : "var(--accent-border)"}`, background: "var(--surface)" }}>
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={styles.typeBadge(msg.type)}>
                    {t(TYPE_LABELS[msg.type] || msg.type)}
                  </span>
                  {!msg.read && <span className="w-2 h-2 rounded-full" style={{ background: "var(--accent)" }} />}
                </div>
                <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{formatDate(msg.createdAt)}</span>
              </div>
              <h3 className="text-sm font-semibold mb-1" style={{ color: "var(--text)" }}>{msg.title}</h3>
              <p className="text-xs" style={{ color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {msg.body}
              </p>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
