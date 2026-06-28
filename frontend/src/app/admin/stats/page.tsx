"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/LanguageProvider";

interface Stats {
  overview: {
    totalUsers: number;
    totalReports: number;
    reportsLast30d: number;
    reportsLast7d: number;
    reportsToday: number;
  };
  dailyData: { date: string; count: number }[];
  usersPerDay: { date: string; count: number }[];
  topRegisters: { source: string; count: number }[];
  statusBreakdown: { status: string; count: number }[];
  sourceBreakdown: Record<string, Record<string, number>>;
  targetTypeBreakdown: { targetType: string; count: number }[];
  hourlyDistribution: { hour: number; count: number }[];
}

export default function AdminStatsPage() {
  const t = useT();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/stats")
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to load stats");
        }
        return res.json();
      })
      .then((data) => setStats(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">{t("admin.nacitavam")}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-red-500">{error}</p>
      </div>
    );
  }

  if (!stats) return null;

  const maxDaily = Math.max(...stats.dailyData.map((d) => d.count), 1);
  const maxUsers = Math.max(...stats.usersPerDay.map((d) => d.count), 1);
  const maxHourly = Math.max(...stats.hourlyDistribution.map((d) => d.count), 1);
  const maxReg = Math.max(...stats.topRegisters.map((d) => d.count), 1);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
      <h1 className="text-2xl font-bold">{t("admin.statistiky")}</h1>

      {/* ── Overview cards ──────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard label={t("admin.userovCelkom")} value={stats.overview.totalUsers} />
        <StatCard label={t("admin.reportovCelkom")} value={stats.overview.totalReports} />
        <StatCard label={t("admin.reportov30dni")} value={stats.overview.reportsLast30d} />
        <StatCard label={t("admin.reportov7dni")} value={stats.overview.reportsLast7d} />
        <StatCard label={t("admin.dnes")} value={stats.overview.reportsToday} />
      </div>

      {/* ── Reports per day ─────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold mb-3">{t("admin.reportyZaDen")}</h2>
        <div className="flex items-end gap-1 h-40 bg-muted/30 rounded-lg p-3">
          {stats.dailyData.length === 0 ? (
            <p className="text-sm text-muted-foreground m-auto">{t("admin.ziadneData")}</p>
          ) : (
            stats.dailyData.map((d) => (
              <div
                key={d.date}
                className="flex-1 bg-blue-500/70 rounded-t hover:bg-blue-500 transition-colors"
                style={{ height: `${(d.count / maxDaily) * 100}%` }}
                title={`${d.date}: ${d.count}`}
              />
            ))
          )}
        </div>
        {stats.dailyData.length > 0 && (
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>{stats.dailyData[0]?.date}</span>
            <span>{stats.dailyData[stats.dailyData.length - 1]?.date}</span>
          </div>
        )}
      </section>

      {/* ── Active users per day ────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold mb-3">{t("admin.aktivniUseri")}</h2>
        <div className="flex items-end gap-1 h-32 bg-muted/30 rounded-lg p-3">
          {stats.usersPerDay.length === 0 ? (
            <p className="text-sm text-muted-foreground m-auto">{t("admin.ziadneData")}</p>
          ) : (
            stats.usersPerDay.map((d) => (
              <div
                key={d.date}
                className="flex-1 bg-green-500/70 rounded-t hover:bg-green-500 transition-colors"
                style={{ height: `${(d.count / maxUsers) * 100}%` }}
                title={`${d.date}: ${d.count}`}
              />
            ))
          )}
        </div>
      </section>

      {/* ── Top registers ───────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold mb-3">{t("admin.najvyhladavanejsie")}</h2>
        <div className="space-y-2">
          {stats.topRegisters.map((r) => (
            <div key={r.source} className="flex items-center gap-3">
              <span className="text-sm w-48 truncate">{r.source}</span>
              <div className="flex-1 bg-muted/30 rounded h-6 overflow-hidden">
                <div
                  className="bg-purple-500/70 h-full rounded transition-all"
                  style={{ width: `${(r.count / maxReg) * 100}%` }}
                />
              </div>
              <span className="text-sm font-mono w-12 text-right">{r.count}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Hourly distribution ─────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold mb-3">{t("admin.rozlozenieDna")}</h2>
        <div className="flex items-end gap-1 h-32 bg-muted/30 rounded-lg p-3">
          {stats.hourlyDistribution.map((d) => (
            <div
              key={d.hour}
              className="flex-1 bg-orange-500/70 rounded-t hover:bg-orange-500 transition-colors"
              style={{ height: `${(d.count / maxHourly) * 100}%` }}
              title={`${d.hour}:00 — ${d.count}`}
            />
          ))}
        </div>
        <div className="flex justify-between text-xs text-muted-foreground mt-1">
          <span>0:00</span>
          <span>6:00</span>
          <span>12:00</span>
          <span>18:00</span>
          <span>23:00</span>
        </div>
      </section>

      {/* ── Status + target type ────────────────────── */}
      <div className="grid sm:grid-cols-2 gap-6">
        <section>
          <h2 className="text-lg font-semibold mb-3">{t("admin.stavReportov")}</h2>
          <div className="space-y-2">
            {stats.statusBreakdown.map((s) => (
              <div key={s.status} className="flex justify-between text-sm">
                <span className={statusColor(s.status)}>{s.status}</span>
                <span className="font-mono">{s.count}</span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-3">{t("admin.typVyhladavania")}</h2>
          <div className="space-y-2">
            {stats.targetTypeBreakdown.map((tt) => (
              <div key={tt.targetType} className="flex justify-between text-sm">
                <span>{tt.targetType === "COMPANY" ? t("admin.firmaIco") : t("admin.osoba")}</span>
                <span className="font-mono">{tt.count}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* ── Source success/failure table ────────────── */}
      <section>
        <h2 className="text-lg font-semibold mb-3">{t("admin.uspesnostScraperov")}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 px-3">{t("admin.register")}</th>
                <th className="text-right py-2 px-3 text-green-600">SUCCESS</th>
                <th className="text-right py-2 px-3 text-red-500">FAILED</th>
                <th className="text-right py-2 px-3 text-yellow-600">UNAVAILABLE</th>
                <th className="text-right py-2 px-3">{t("admin.celkom")}</th>
                <th className="text-right py-2 px-3">{t("admin.uspesnost")}</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(stats.sourceBreakdown)
                .sort(([, a], [, b]) => (b.SUCCESS || 0) + (b.FAILED || 0) - ((a.SUCCESS || 0) + (a.FAILED || 0)))
                .map(([source, counts]) => {
                  const total = Object.values(counts).reduce((s, n) => s + n, 0);
                  const success = counts.SUCCESS || 0;
                  const failed = counts.FAILED || 0;
                  const unavail = counts.UNAVAILABLE || 0;
                  const rate = total > 0 ? ((success / total) * 100).toFixed(0) : "—";
                  return (
                    <tr key={source} className="border-b border-muted/30 hover:bg-muted/20">
                      <td className="py-2 px-3">{source}</td>
                      <td className="py-2 px-3 text-right text-green-600">{success}</td>
                      <td className="py-2 px-3 text-right text-red-500">{failed}</td>
                      <td className="py-2 px-3 text-right text-yellow-600">{unavail}</td>
                      <td className="py-2 px-3 text-right font-mono">{total}</td>
                      <td className="py-2 px-3 text-right">
                        {rate !== "—" ? `${rate}%` : "—"}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-card border rounded-lg p-4">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  );
}

function statusColor(status: string): string {
  switch (status) {
    case "COMPLETED": return "text-green-600";
    case "FAILED": return "text-red-500";
    case "PARTIAL": return "text-yellow-600";
    case "PROCESSING": return "text-blue-500";
    case "PENDING": return "text-muted-foreground";
    default: return "";
  }
}
