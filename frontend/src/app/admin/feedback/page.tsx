"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/LanguageProvider";
import { LOCALE_MAP } from "@/lib/i18n";
import { useLang } from "@/components/LanguageProvider";
import { getServerSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

interface Feedback {
  id: string;
  category: string;
  message: string;
  status: string;
  requestId: string | null;
  createdAt: string;
  user: {
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

export default async function AdminFeedbackPage() {
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

  return <AdminFeedbackContent />;
}

function AdminFeedbackContent() {
  const t = useT();
  const { lang } = useLang();
  const locale = LOCALE_MAP[lang];
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState<string>("BUG");
  const [filterStatus, setFilterStatus] = useState<string>("ALL");

  const fetchFeedbacks = async () => {
    setLoading(true);
    try {
      const url = new URL("/api/admin/feedback", window.location.origin);
      if (filterCategory !== "ALL") url.searchParams.set("category", filterCategory);
      const res = await fetch(url.toString());
      if (res.ok) {
        const data = await res.json();
        setFeedbacks(data.feedbacks || []);
      }
    } catch (error) {
      console.error("Failed to fetch feedbacks", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFeedbacks();
  }, [filterCategory]);

  const updateStatus = async (feedbackId: string, newStatus: string) => {
    try {
      const res = await fetch("/api/admin/feedback", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: feedbackId, status: newStatus }),
      });
      if (res.ok) {
        setFeedbacks(feedbacks.map(f => 
          f.id === feedbackId ? { ...f, status: newStatus } : f
        ));
      }
    } catch (error) {
      console.error("Failed to update status", error);
    }
  };

  const filteredFeedbacks = filterStatus === "ALL" 
    ? feedbacks 
    : feedbacks.filter(f => f.status === filterStatus);

  const categoryColors: Record<string, string> = {
    BUG: "var(--danger)",
    IMPROVEMENT: "var(--info)",
    QUESTION: "var(--warning)",
    OTHER: "var(--text-secondary)",
  };

  const statusColors: Record<string, string> = {
    OPEN: "var(--danger)",
    RESOLVED: "var(--success)",
    CLOSED: "var(--text-muted)",
  };

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 pt-8 pb-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight mb-2" style={{ color: "var(--text)" }}>
          Admin - Feedback
        </h1>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Správa používateľského feedbacku a bug reportov
        </p>
      </div>

      {/* Filters */}
      <div className="card p-4 mb-6 flex gap-4 items-center">
        <div className="flex items-center gap-2">
          <label className="text-xs" style={{ color: "var(--text-muted)" }}>Kategória:</label>
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="px-3 py-1.5 rounded-lg text-xs border"
            style={{
              background: "var(--surface)",
              borderColor: "var(--border)",
              color: "var(--text)",
            }}
          >
            <option value="ALL">Všetky</option>
            <option value="BUG">BUG</option>
            <option value="IMPROVEMENT">IMPROVEMENT</option>
            <option value="QUESTION">QUESTION</option>
            <option value="OTHER">OTHER</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs" style={{ color: "var(--text-muted)" }}>Status:</label>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-3 py-1.5 rounded-lg text-xs border"
            style={{
              background: "var(--surface)",
              borderColor: "var(--border)",
              color: "var(--text)",
            }}
          >
            <option value="ALL">Všetky</option>
            <option value="OPEN">OPEN</option>
            <option value="RESOLVED">RESOLVED</option>
            <option value="CLOSED">CLOSED</option>
          </select>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="card p-8 text-center">
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Načítavam...
          </p>
        </div>
      ) : filteredFeedbacks.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Žiadne feedbacky.
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ background: "var(--bg-muted)" }}>
                <th className="px-4 py-3 text-left font-semibold" style={{ color: "var(--text)" }}>
                  Dátum
                </th>
                <th className="px-4 py-3 text-left font-semibold" style={{ color: "var(--text)" }}>
                  Kategória
                </th>
                <th className="px-4 py-3 text-left font-semibold" style={{ color: "var(--text)" }}>
                  Používateľ
                </th>
                <th className="px-4 py-3 text-left font-semibold" style={{ color: "var(--text)" }}>
                  Správa
                </th>
                <th className="px-4 py-3 text-left font-semibold" style={{ color: "var(--text)" }}>
                  Report ID
                </th>
                <th className="px-4 py-3 text-left font-semibold" style={{ color: "var(--text)" }}>
                  Status
                </th>
                <th className="px-4 py-3 text-left font-semibold" style={{ color: "var(--text)" }}>
                  Akcie
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredFeedbacks.map((feedback) => (
                <tr key={feedback.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>
                    {formatDate(feedback.createdAt, locale)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                      style={{
                        background: `${categoryColors[feedback.category]}22`,
                        color: categoryColors[feedback.category],
                      }}
                    >
                      {feedback.category}
                    </span>
                  </td>
                  <td className="px-4 py-3" style={{ color: "var(--text)" }}>
                    <div>
                      <div className="font-medium">{feedback.user.name || "—"}</div>
                      <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                        {feedback.user.email}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 max-w-md" style={{ color: "var(--text-secondary)" }}>
                    <div className="whitespace-pre-wrap break-words">{feedback.message}</div>
                  </td>
                  <td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>
                    {feedback.requestId ? (
                      <a
                        href={`/reports/${feedback.requestId}`}
                        className="font-mono hover:underline"
                        style={{ color: "var(--accent)" }}
                      >
                        {feedback.requestId.slice(0, 8)}…
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                      style={{
                        background: `${statusColors[feedback.status]}22`,
                        color: statusColors[feedback.status],
                      }}
                    >
                      {feedback.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={feedback.status}
                      onChange={(e) => updateStatus(feedback.id, e.target.value)}
                      className="px-2 py-1 rounded text-[10px] border"
                      style={{
                        background: "var(--surface)",
                        borderColor: "var(--border)",
                        color: "var(--text)",
                      }}
                    >
                      <option value="OPEN">OPEN</option>
                      <option value="RESOLVED">RESOLVED</option>
                      <option value="CLOSED">CLOSED</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
