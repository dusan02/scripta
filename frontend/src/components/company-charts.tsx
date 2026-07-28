"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell,
} from "recharts";

function fmtEUR(val: number | null | undefined): string {
  if (val === null || val === undefined) return "—";
  const abs = Math.abs(val);
  if (abs >= 1_000_000) return `${(val / 1_000_000).toFixed(2)} mil. €`;
  if (abs >= 1_000) return `${(val / 1_000).toFixed(1)} tis. €`;
  return `${val.toFixed(0)} €`;
}

type ChartData = {
  year: string;
  tržby: number | null;
  zisk: number | null;
  aktíva: number | null;
  vlastnéImanie: number | null;
};

type BalanceData = {
  name: string;
  value: number | null;
  color: string;
};

export function RevenueProfitChart({ data }: { data: ChartData[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
        <XAxis dataKey="year" tick={{ fill: "var(--text-muted)", fontSize: 12 }} axisLine={{ stroke: "var(--border)" }} />
        <YAxis tickFormatter={(v: number) => v >= 1e6 ? `${(v/1e6).toFixed(0)}M` : v >= 1e3 ? `${(v/1e3).toFixed(0)}k` : ""} tick={{ fill: "var(--text-muted)", fontSize: 11 }} axisLine={{ stroke: "var(--border)" }} />
        <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} formatter={(v: any) => fmtEUR(v as number)} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="tržby" fill="#10b981" radius={[4, 4, 0, 0]} name="Tržby" />
        <Bar dataKey="zisk" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Zisk/Strata" />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function AssetsEquityChart({ data }: { data: ChartData[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
        <XAxis dataKey="year" tick={{ fill: "var(--text-muted)", fontSize: 12 }} axisLine={{ stroke: "var(--border)" }} />
        <YAxis tickFormatter={(v: number) => v >= 1e6 ? `${(v/1e6).toFixed(0)}M` : v >= 1e3 ? `${(v/1e3).toFixed(0)}k` : ""} tick={{ fill: "var(--text-muted)", fontSize: 11 }} axisLine={{ stroke: "var(--border)" }} />
        <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} formatter={(v: any) => fmtEUR(v as number)} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="aktíva" fill="#f59e0b" radius={[4, 4, 0, 0]} name="Celkové aktíva" />
        <Bar dataKey="vlastnéImanie" fill="#8b5cf6" radius={[4, 4, 0, 0]} name="Vlastné imanie" />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function BalanceDonutChart({ data }: { data: BalanceData[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2}>
          {data.map((entry, i) => <Cell key={i} fill={entry.color} />)}
        </Pie>
        <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} formatter={(v: any) => fmtEUR(v as number)} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
