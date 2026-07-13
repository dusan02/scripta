"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/LanguageProvider";
import { LOCALE_MAP } from "@/lib/i18n";
import { useLang } from "@/components/LanguageProvider";
import { getServerSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

interface AdminMessage {
  id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  senderId: string | null;
  userId: string | null;
  sender?: {
    id: string;
    email: string;
    name: string | null;
  };
}

function formatDate(iso: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export default async function AdminMessagesPage() {
  const session = await getServerSession();
  if (!session?.user) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  });

  if (user?.role !== "ADMIN") {
    return (
      <div className="max-w-[1000px] mx-auto px-4 sm:px-6 pt-8 pb-8">
        <div className="card p-8 text-center">
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Prístup zamietnutý. Vyžaduje sa rola ADMIN.
          </p>
        </div>
      </div>
    );
  }

  return <AdminMessagesContent />;
}

function AdminMessagesContent() {
  const t = useT();
  const { lang } = useLang();
  const locale = LOCALE_MAP[lang];
  const [messages, setMessages] = useState<AdminMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"inbox" | "sent">("inbox");
  const [showCompose, setShowCompose] = useState(false);
  const [composeTitle, setComposeTitle] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeType, setComposeType] = useState("ANNOUNCEMENT");
  const [composeTarget, setComposeTarget] = useState("");
  const [sending, setSending] = useState(false);

  const fetchMessages = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/messages?filter=${filter}`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
      }
    } catch (error) {
      console.error("Failed to fetch messages", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMessages();
  }, [filter]);

  const sendMessage = async () => {
    if (!composeTitle.trim() || !composeBody.trim()) return;
    setSending(true);
    try {
      const res = await fetch("/api/admin/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: composeTitle,
          message: composeBody,
          type: composeType,
          targetUserId: composeTarget.trim() || null,
        }),
      });
      if (res.ok) {
        setComposeTitle("");
        setComposeBody("");
        setComposeTarget("");
        setShowCompose(false);
        fetchMessages();
      }
    } catch (error) {
      console.error("Failed to send message", error);
    } finally {
      setSending(false);
    }
  };

  const typeColors: Record<string, string> = {
    ANNOUNCEMENT: "var(--accent)",
    REPLY: "var(--info-text)",
    SYSTEM: "var(--text-muted)",
    USER: "var(--warning)",
  };

  const typeLabels: Record<string, string> = {
    ANNOUNCEMENT: "Novinka",
    REPLY: "Odpoveď",
    SYSTEM: "Systém",
    USER: "Od používateľa",
  };

  return (
    <div className="max-w-[1000px] mx-auto px-4 sm:px-6 pt-8 pb-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight mb-1" style={{ color: "var(--text)" }}>
            Admin — Správy
          </h1>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Prijaté správy od používateľov a odoslané oznámenia
          </p>
        </div>
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
          {showCompose ? "Zrušiť" : "+ Nová správa"}
        </button>
      </div>

      {/* Compose form */}
      {showCompose && (
        <div className="card p-6 mb-6" style={{ border: "1px solid var(--border)" }}>
          <h2 className="text-sm font-bold mb-4" style={{ color: "var(--text)" }}>
            Poslať správu používateľom
          </h2>
          <div className="flex flex-col gap-4">
            <div>
              <label className="text-xs block mb-1" style={{ color: "var(--text-muted)" }}>Typ správy</label>
              <select
                value={composeType}
                onChange={(e) => setComposeType(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm border"
                style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)" }}
              >
                <option value="ANNOUNCEMENT">Novinka (pre všetkých alebo konkrétneho používateľa)</option>
                <option value="REPLY">Odpoveď (na podnet používateľa)</option>
                <option value="SYSTEM">Systémové oznámenie</option>
              </select>
            </div>
            <div>
              <label className="text-xs block mb-1" style={{ color: "var(--text-muted)" }}>
                Cieľový používateľ (User ID — prázdne = broadcast všetkým)
              </label>
              <input
                type="text"
                value={composeTarget}
                onChange={(e) => setComposeTarget(e.target.value)}
                placeholder="Zanechajte prázdne pre broadcast"
                className="w-full px-3 py-2 rounded-lg text-sm border"
                style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)" }}
              />
            </div>
            <div>
              <label className="text-xs block mb-1" style={{ color: "var(--text-muted)" }}>Predmet</label>
              <input
                type="text"
                value={composeTitle}
                onChange={(e) => setComposeTitle(e.target.value)}
                placeholder="Nadpis správy"
                className="w-full px-3 py-2 rounded-lg text-sm border"
                style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)" }}
              />
            </div>
            <div>
              <label className="text-xs block mb-1" style={{ color: "var(--text-muted)" }}>Správa</label>
              <textarea
                value={composeBody}
                onChange={(e) => setComposeBody(e.target.value)}
                placeholder="Text správy..."
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
              {sending ? "Odosielam..." : "Odoslať"}
            </button>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setFilter("inbox")}
          className="px-4 py-2 rounded-lg text-sm font-medium"
          style={{
            background: filter === "inbox" ? "var(--accent)" : "var(--surface)",
            color: filter === "inbox" ? "var(--accent-button-text)" : "var(--text-secondary)",
            border: filter === "inbox" ? "none" : "1px solid var(--border)",
            cursor: "pointer",
          }}
        >
          Prijaté (od používateľov)
        </button>
        <button
          onClick={() => setFilter("sent")}
          className="px-4 py-2 rounded-lg text-sm font-medium"
          style={{
            background: filter === "sent" ? "var(--accent)" : "var(--surface)",
            color: filter === "sent" ? "var(--accent-button-text)" : "var(--text-secondary)",
            border: filter === "sent" ? "none" : "1px solid var(--border)",
            cursor: "pointer",
          }}
        >
          Odoslané (od admina)
        </button>
      </div>

      {/* Messages list */}
      {loading ? (
        <div className="card p-8 text-center">
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>Načítavam...</p>
        </div>
      ) : messages.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>Žiadne správy.</p>
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
                      background: `${typeColors[msg.type] || "var(--bg-muted)"}20`,
                      color: typeColors[msg.type] || "var(--text-muted)",
                    }}
                  >
                    {typeLabels[msg.type] || msg.type}
                  </span>
                  {filter === "inbox" && msg.sender && (
                    <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                      {msg.sender.email}
                    </span>
                  )}
                  {filter === "sent" && msg.userId && (
                    <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                      → cielené
                    </span>
                  )}
                  {filter === "sent" && !msg.userId && (
                    <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                      → broadcast
                    </span>
                  )}
                </div>
                <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                  {formatDate(msg.createdAt, locale)}
                </span>
              </div>
              <h3 className="text-sm font-semibold mb-1" style={{ color: "var(--text)" }}>
                {msg.title}
              </h3>
              <p className="text-xs whitespace-pre-wrap" style={{ color: "var(--text-secondary)" }}>
                {msg.body}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
