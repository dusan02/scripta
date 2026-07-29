"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  Sankey, Layer,
} from "recharts";
import { useMemo } from "react";

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

export function BalanceSankeyChart({ data }: { data: BalanceData[] }) {
  const { sankeyData, nodeColors } = useMemo(() => {
    const valid = data.filter(d => d.value !== null && d.value !== undefined && d.value > 0);
    if (valid.length === 0) return { sankeyData: null, nodeColors: [] };

    const nodes = [
      { name: "Aktíva" },
      ...valid.map(d => ({ name: d.name })),
    ];

    const links = valid.map((d, i) => ({
      source: 0,
      target: i + 1,
      value: d.value as number,
    }));

    const colors = ["#3b82f6", ...valid.map(d => d.color)];

    return { sankeyData: { nodes, links }, nodeColors: colors };
  }, [data]);

  if (!sankeyData) {
    return (
      <div className="flex items-center justify-center h-[220px] text-sm" style={{ color: "var(--text-muted)" }}>
        Údaje o súvahy nie sú dostupné
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <Sankey
        data={sankeyData}
        nodePadding={16}
        nodeWidth={8}
        linkCurvature={0.5}
        margin={{ top: 10, right: 90, bottom: 10, left: 90 }}
        node={(props: any) => {
          const { x, y, width, height, index } = props;
          const color = nodeColors[index] || "#94a3b8";
          const name = sankeyData.nodes[index]?.name || "";
          const value = index === 0
            ? sankeyData.links.reduce((s: number, l: any) => s + l.value, 0)
            : sankeyData.links.find((l: any) => l.target === index)?.value || 0;
          const isSource = index === 0;
          const labelX = isSource ? x - 8 : x + width + 8;
          const textAnchor = isSource ? "end" : "start";
          return (
            <Layer key={`node-${index}`}>
              <rect x={x} y={y} width={width} height={height} fill={color} rx={2} />
              <text
                x={labelX}
                y={y + height / 2}
                dy=".35em"
                textAnchor={textAnchor}
                fontSize={11}
                fill="var(--text)"
              >
                {name}
              </text>
              <text
                x={labelX}
                y={y + height / 2 + 14}
                dy=".35em"
                textAnchor={textAnchor}
                fontSize={10}
                fill="var(--text-muted)"
              >
                {fmtEUR(value)}
              </text>
            </Layer>
          );
        }}
        link={(props: any) => {
          const { sourceX, targetX, sourceY, targetY, sourceControlX, targetControlX, linkWidth, index } = props;
          const link = sankeyData.links[index];
          const color = nodeColors[link.target] || "#94a3b8";
          return (
            <Layer key={`link-${index}`} opacity={0.4}>
              <path
                d={`M${sourceX},${sourceY}C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
                stroke={color}
                strokeWidth={Math.max(1, linkWidth)}
                fill="none"
              />
            </Layer>
          );
        }}
      >
        <Tooltip
          contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
          formatter={(v: any) => fmtEUR(v as number)}
        />
      </Sankey>
    </ResponsiveContainer>
  );
}
