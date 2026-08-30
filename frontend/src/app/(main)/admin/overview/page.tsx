"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/LanguageProvider";
import Link from "next/link";
import { getServerSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

interface Stats {
  totalUsers: number;
  totalReports: number;
  completedReports: number;
  failedReports: number;
  pendingReports: number;
  totalFeedback: number;
  openFeedback: number;
  totalMessages: number;
  userMessages: number;
  totalWalletTransactions: number;
  totalCreditsSpent: number;
}

interface RecentReport {
  id: string;
  companyName: string | null;
  ico: string | null;
  status: string;
  createdAt: string;
  user: { id: string; email: string };
}

interface RecentUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  COMPLETED: "var(--success)",
  FAILED: "var(--danger)",
  PENDING: "var(--warning)",
  PROCESSING: "var(--info-text)",
  PARTIAL: "var(--warning)",
};

function StatCard({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div
      className="card p-5"
      style={{ border: "1px solid var(--border)", background: "var(--surface)" }}
    >
      <div style={{ fontSize: 28, fontWeight: 900, color: color || "var(--text)" }}>{value}</div>
      <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>{label}</div>
    </div>
  );
}

export default async function AdminOverviewPage() {
  const session = await getServerSession();
  if (!session?.user) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  });

  if (user?.role !== "ADMIN") {
    return (
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 pt-8 pb-8">
        <div className="card p-8 text-center">
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Prístup zamietnutý. Vyžaduje sa rola ADMIN.
          </p>
        </div>
      </div>
    );
  }

  return <AdminOverviewContent />;
}

function AdminOverviewContent() {
  const t = useT();
  const [stats, setStats] = useState<Stats | null>(null);
  const [reports, setReports] = useState<RecentReport[]>([]);
  const [users, setUsers] = useState<RecentUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/admin/overview")
      .then((r) => {
        if (!r.ok) throw new Error("Not authorized");
        return r.json();
      })
      .then((data) => {
        setStats(data.stats);
        setReports(data.recentReports || []);
        setUsers(data.recentUsers || []);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 pt-8 pb-8">
        <div className="h-8 rounded-lg animate-pulse" style={{ background: "var(--bg-muted)", marginBottom: 24 }} />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-24 rounded-lg animate-pulse" style={{ background: "var(--bg-muted)" }} />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 pt-8 pb-8">
        <div className="card p-8 text-center" style={{ border: "1px solid var(--border)" }}>
          <p style={{ color: "var(--text-muted)" }}>{t("admin.nacitanieZlyhalo")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 pt-8 pb-8">
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 24 }}>{t("admin.prehled")}</h1>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label={t("admin.pouzivatelia")} value={stats!.totalUsers} />
        <StatCard label={t("admin.reportyCelkom")} value={stats!.totalReports} />
        <StatCard label={t("admin.dokoncene")} value={stats!.completedReports} color="var(--success)" />
        <StatCard label={t("admin.prebiejajuce")} value={stats!.pendingReports} color="var(--info-text)" />
        <StatCard label={t("admin.zlyhanе")} value={stats!.failedReports} color="var(--danger)" />
        <StatCard label={t("admin.spatnaVazba")} value={`${stats!.openFeedback}/${stats!.totalFeedback}`} />
        <StatCard label={t("admin.spravyPouzivatelov")} value={stats!.userMessages} />
        <StatCard label={t("admin.minuteKredity")} value={stats!.totalCreditsSpent} />
      </div>

      {/* Recent reports */}
      <div className="mb-8">
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>{t("admin.posledneReporty")}</h2>
        <div className="card overflow-x-auto" style={{ border: "1px solid var(--border)", overflow: "hidden" }}>
          <table className="w-full" style={{ fontSize: 14, minWidth: 600 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-muted)" }}>
                <th style={{ textAlign: "left", padding: "12px 16px", fontWeight: 600 }}>{t("admin.firma")}</th>
                <th style={{ textAlign: "left", padding: "12px 16px", fontWeight: 600 }}>{t("admin.ico")}</th>
                <th style={{ textAlign: "left", padding: "12px 16px", fontWeight: 600 }}>{t("admin.pouzivatel")}</th>
                <th style={{ textAlign: "left", padding: "12px 16px", fontWeight: 600 }}>{t("admin.stav")}</th>
                <th style={{ textAlign: "left", padding: "12px 16px", fontWeight: 600 }}>{t("admin.datum")}</th>
              </tr>
            </thead>
            <tbody>
              {reports.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>
                    {t("admin.ziadneReporty")}
                  </td>
                </tr>
              ) : (
                reports.map((r) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "10px 16px" }}>{r.companyName || "—"}</td>
                    <td style={{ padding: "10px 16px", color: "var(--text-secondary)" }}>{r.ico || "—"}</td>
                    <td style={{ padding: "10px 16px", color: "var(--text-secondary)" }}>
                      <Link href={`/admin/users/${r.user.id}`} style={{ color: "var(--text-secondary)" }}>
                        {r.user.email}
                      </Link>
                    </td>
                    <td style={{ padding: "10px 16px" }}>
                      <span style={{ color: STATUS_COLORS[r.status] || "var(--text)", fontWeight: 600, fontSize: 13 }}>
                        {r.status}
                      </span>
                    </td>
                    <td style={{ padding: "10px 16px", color: "var(--text-muted)", fontSize: 13 }}>
                      {new Date(r.createdAt).toLocaleDateString("sk-SK")}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent users */}
      <div>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>{t("admin.posledniPouzivatelia")}</h2>
        <div className="card overflow-x-auto" style={{ border: "1px solid var(--border)", overflow: "hidden" }}>
          <table className="w-full" style={{ fontSize: 14, minWidth: 600 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-muted)" }}>
                <th style={{ textAlign: "left", padding: "12px 16px", fontWeight: 600 }}>{t("admin.email")}</th>
                <th style={{ textAlign: "left", padding: "12px 16px", fontWeight: 600 }}>{t("admin.meno")}</th>
                <th style={{ textAlign: "left", padding: "12px 16px", fontWeight: 600 }}>{t("admin.rola")}</th>
                <th style={{ textAlign: "left", padding: "12px 16px", fontWeight: 600 }}>{t("admin.registracia")}</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>
                    {t("admin.ziadniPouzivatelia")}
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "10px 16px" }}>
                      <Link href={`/admin/users/${u.id}`} style={{ color: "var(--text)" }}>
                        {u.email}
                      </Link>
                    </td>
                    <td style={{ padding: "10px 16px", color: "var(--text-secondary)" }}>{u.name || "—"}</td>
                    <td style={{ padding: "10px 16px" }}>
                      <span style={{ fontSize: 12, fontWeight: 600, padding: "2px 8px", borderRadius: 4, background: u.role === "ADMIN" ? "var(--accent-light)" : "var(--bg-muted)", color: u.role === "ADMIN" ? "var(--accent)" : "var(--text-secondary)" }}>
                        {u.role}
                      </span>
                    </td>
                    <td style={{ padding: "10px 16px", color: "var(--text-muted)", fontSize: 13 }}>
                      {new Date(u.createdAt).toLocaleDateString("sk-SK")}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
