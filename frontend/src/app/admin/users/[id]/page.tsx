"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/LanguageProvider";
import Link from "next/link";

interface UserDetail {
  user: {
    id: string;
    email: string;
    name: string | null;
    role: string;
    planName: string | null;
    planRenewalDate: string | null;
    subscriptionStatus: string | null;
    subscriptionEndsAt: string | null;
    createdAt: string;
    wallet: { id: string; balance: string; currency: string } | null;
  };
  transactions: {
    id: string;
    amount: number;
    type: string;
    status: string;
    description: string | null;
    provider: string | null;
    providerReference: string | null;
    reportRequestId: string | null;
    createdAt: string;
  }[];
  reports: {
    id: string;
    companyName: string | null;
    ico: string | null;
    status: string;
    createdAt: string;
    completedAt: string | null;
  }[];
  creditBatches: {
    id: string;
    amount: number;
    remaining: number;
    source: string;
    planName: string | null;
    expiresAt: string;
    createdAt: string;
  }[];
  summary: {
    totalSpent: number;
    totalPurchased: number;
    totalRefunded: number;
    walletBalance: number;
    activeBatches: number;
    totalReports: number;
  };
}

const TYPE_COLORS: Record<string, string> = {
  TOPUP: "var(--success)",
  CHARGE: "var(--danger)",
  REFUND: "var(--info-text)",
};

const STATUS_COLORS: Record<string, string> = {
  COMPLETED: "var(--success)",
  FAILED: "var(--danger)",
  PENDING: "var(--warning)",
  PROCESSING: "var(--info-text)",
  PARTIAL: "var(--warning)",
  CANCELLED: "var(--text-muted)",
};

function StatCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="card p-5" style={{ border: "1px solid var(--border)", background: "var(--surface)" }}>
      <div style={{ fontSize: 28, fontWeight: 900, color: color || "var(--text)" }}>{value}</div>
      <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>{label}</div>
    </div>
  );
}

export default function AdminUserDetailPage({ params }: { params: { id: string } }) {
  const t = useT();
  const [data, setData] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`/api/admin/users/${params.id}`)
      .then((r) => {
        if (!r.ok) throw new Error("Not authorized");
        return r.json();
      })
      .then((d) => setData(d))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [params.id]);

  if (loading) {
    return (
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 pt-8 pb-8">
        <div className="h-8 rounded-lg animate-pulse" style={{ background: "var(--bg-muted)", marginBottom: 24 }} />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-24 rounded-lg animate-pulse" style={{ background: "var(--bg-muted)" }} />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 pt-8 pb-8">
        <div className="card p-8 text-center" style={{ border: "1px solid var(--border)" }}>
          <p style={{ color: "var(--text-muted)" }}>Načítanie používateľa zlyhalo.</p>
        </div>
      </div>
    );
  }

  const { user, transactions, reports, creditBatches, summary } = data;

  return (
    <div className="max-w-[1200px] mx-auto px-4 sm:px-6 pt-8 pb-8">
      {/* Back link */}
      <Link href="/admin/overview" style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 16, display: "inline-block" }}>
        ← Späť na prehľad
      </Link>

      {/* User header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800 }}>{user.name || user.email}</h1>
        <p style={{ color: "var(--text-muted)", fontSize: 14, marginTop: 4 }}>
          {user.email} · {user.role === "ADMIN" ? "Admin" : "Používateľ"} · Registrácia: {new Date(user.createdAt).toLocaleDateString("sk-SK")}
        </p>
        {user.planName && (
          <p style={{ color: "var(--text-secondary)", fontSize: 14, marginTop: 4 }}>
            Plán: <strong>{user.planName}</strong>
            {user.subscriptionStatus && ` · Stav: ${user.subscriptionStatus}`}
            {user.planRenewalDate && ` · Obnova: ${new Date(user.planRenewalDate).toLocaleDateString("sk-SK")}`}
          </p>
        )}
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        <StatCard label="Wallet balance" value={summary.walletBalance} color="var(--success)" />
        <StatCard label="Nakúpené kredity" value={summary.totalPurchased} />
        <StatCard label="Minuté kredity" value={summary.totalSpent} color="var(--danger)" />
        <StatCard label="Vrátené kredity" value={summary.totalRefunded} color="var(--info-text)" />
        <StatCard label="Aktívne batche" value={summary.activeBatches} />
        <StatCard label="Reporty" value={summary.totalReports} />
      </div>

      <div className="grid lg:grid-cols-2 gap-8">
        {/* Transaction history */}
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>História transakcií</h2>
          <div className="card" style={{ border: "1px solid var(--border)", overflow: "hidden" }}>
            <table className="w-full" style={{ fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-muted)" }}>
                  <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 600 }}>Dátum</th>
                  <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 600 }}>Typ</th>
                  <th style={{ textAlign: "right", padding: "10px 12px", fontWeight: 600 }}>Suma</th>
                  <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 600 }}>Popis</th>
                </tr>
              </thead>
              <tbody>
                {transactions.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>
                      Žiadne transakcie
                    </td>
                  </tr>
                ) : (
                  transactions.map((tx) => (
                    <tr key={tx.id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "8px 12px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                        {new Date(tx.createdAt).toLocaleDateString("sk-SK")}
                      </td>
                      <td style={{ padding: "8px 12px" }}>
                        <span style={{ color: TYPE_COLORS[tx.type] || "var(--text)", fontWeight: 600 }}>
                          {tx.type}
                        </span>
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {tx.type === "CHARGE" ? "-" : "+"}{tx.amount}
                      </td>
                      <td style={{ padding: "8px 12px", color: "var(--text-secondary)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {tx.description || "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Credit batches */}
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Kreditové batche</h2>
          <div className="card" style={{ border: "1px solid var(--border)", overflow: "hidden" }}>
            <table className="w-full" style={{ fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-muted)" }}>
                  <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 600 }}>Zdroj</th>
                  <th style={{ textAlign: "right", padding: "10px 12px", fontWeight: 600 }}>Pôvodných</th>
                  <th style={{ textAlign: "right", padding: "10px 12px", fontWeight: 600 }}>Zostáva</th>
                  <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 600 }}>Expirácia</th>
                </tr>
              </thead>
              <tbody>
                {creditBatches.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>
                      Žiadne batche
                    </td>
                  </tr>
                ) : (
                  creditBatches.map((b) => (
                    <tr key={b.id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "8px 12px" }}>
                        {b.source}
                        {b.planName && <span style={{ color: "var(--text-muted)", fontSize: 12 }}> ({b.planName})</span>}
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{b.amount}</td>
                      <td style={{ padding: "8px 12px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        <span style={{ color: b.remaining > 0 ? "var(--success)" : "var(--text-muted)", fontWeight: b.remaining > 0 ? 600 : 400 }}>
                          {b.remaining}
                        </span>
                      </td>
                      <td style={{ padding: "8px 12px", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                        {new Date(b.expiresAt).toLocaleDateString("sk-SK")}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Reports */}
      <div style={{ marginTop: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Reporty používateľa</h2>
        <div className="card" style={{ border: "1px solid var(--border)", overflow: "hidden" }}>
          <table className="w-full" style={{ fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-muted)" }}>
                <th style={{ textAlign: "left", padding: "12px 16px", fontWeight: 600 }}>Firma</th>
                <th style={{ textAlign: "left", padding: "12px 16px", fontWeight: 600 }}>IČO</th>
                <th style={{ textAlign: "left", padding: "12px 16px", fontWeight: 600 }}>Stav</th>
                <th style={{ textAlign: "left", padding: "12px 16px", fontWeight: 600 }}>Vytvorený</th>
                <th style={{ textAlign: "left", padding: "12px 16px", fontWeight: 600 }}>Dokončený</th>
              </tr>
            </thead>
            <tbody>
              {reports.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>
                    Žiadne reporty
                  </td>
                </tr>
              ) : (
                reports.map((r) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "10px 16px" }}>{r.companyName || "—"}</td>
                    <td style={{ padding: "10px 16px", color: "var(--text-secondary)" }}>{r.ico || "—"}</td>
                    <td style={{ padding: "10px 16px" }}>
                      <span style={{ color: STATUS_COLORS[r.status] || "var(--text)", fontWeight: 600, fontSize: 13 }}>
                        {r.status}
                      </span>
                    </td>
                    <td style={{ padding: "10px 16px", color: "var(--text-muted)", fontSize: 13 }}>
                      {new Date(r.createdAt).toLocaleDateString("sk-SK")}
                    </td>
                    <td style={{ padding: "10px 16px", color: "var(--text-muted)", fontSize: 13 }}>
                      {r.completedAt ? new Date(r.completedAt).toLocaleDateString("sk-SK") : "—"}
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
