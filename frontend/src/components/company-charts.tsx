"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
  Sankey, Layer,
} from "recharts";
import { useMemo, useState } from "react";

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
  cash: number | null;
  receivables: number | null;
  inventory: number | null;
  currentAssets: number | null;
  totalAssets: number | null;
  equity: number | null;
  shortTermLiabilities: number | null;
  longTermLiabilities: number | null;
};

export function RevenueProfitChart({ data }: { data: ChartData[] }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const toggle = (key: string) => setHidden(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
        <XAxis dataKey="year" tick={{ fill: "var(--text-muted)", fontSize: 12 }} axisLine={{ stroke: "var(--border)" }} />
        <YAxis tickFormatter={(v: number) => v >= 1e6 ? `${(v/1e6).toFixed(0)}M` : v >= 1e3 ? `${(v/1e3).toFixed(0)}k` : ""} tick={{ fill: "var(--text-muted)", fontSize: 11 }} axisLine={{ stroke: "var(--border)" }} />
        <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} formatter={(v: any) => fmtEUR(v as number)} />
        <Legend wrapperStyle={{ fontSize: 12, cursor: "pointer" }} onClick={(e: any) => { if (e?.dataKey) toggle(e.dataKey); }} />
        <Bar dataKey="tržby" fill="#10b981" radius={[4, 4, 0, 0]} name="Tržby" hide={hidden.has("tržby")} />
        <Bar dataKey="zisk" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Zisk/Strata" hide={hidden.has("zisk")} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function AssetsEquityChart({ data }: { data: ChartData[] }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const toggle = (key: string) => setHidden(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
        <XAxis dataKey="year" tick={{ fill: "var(--text-muted)", fontSize: 12 }} axisLine={{ stroke: "var(--border)" }} />
        <YAxis tickFormatter={(v: number) => v >= 1e6 ? `${(v/1e6).toFixed(0)}M` : v >= 1e3 ? `${(v/1e3).toFixed(0)}k` : ""} tick={{ fill: "var(--text-muted)", fontSize: 11 }} axisLine={{ stroke: "var(--border)" }} />
        <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} formatter={(v: any) => fmtEUR(v as number)} />
        <Legend wrapperStyle={{ fontSize: 12, cursor: "pointer" }} onClick={(e: any) => { if (e?.dataKey) toggle(e.dataKey); }} />
        <Bar dataKey="aktíva" fill="#f59e0b" radius={[4, 4, 0, 0]} name="Celkové aktíva" hide={hidden.has("aktíva")} />
        <Bar dataKey="vlastnéImanie" fill="#8b5cf6" radius={[4, 4, 0, 0]} name="Vlastné imanie" hide={hidden.has("vlastnéImanie")} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function BalanceSankeyChart({ data }: { data: BalanceData }) {
  const { sankeyData, nodeColors, linkColors, nodeLabelLeft } = useMemo(() => {
    const current = data.currentAssets ?? 0;
    const totalAssets = data.totalAssets ?? 0;
    const equity = Math.max(0, data.equity ?? 0);
    const shortLiab = data.shortTermLiabilities ?? 0;
    const longLiab = data.longTermLiabilities ?? 0;

    if (totalAssets <= 0) return { sankeyData: null, nodeColors: [] as string[], linkColors: [] as string[], nodeLabelLeft: [] as boolean[] };

    const nonCurrent = Math.max(0, totalAssets - current);
    const knownLiab = shortLiab + longLiab;
    const ostatnePasiva = Math.max(0, totalAssets - equity - knownLiab);

    // 3-level Sankey: 7 nodes, no crossings possible
    // 0: Obežný majetok, 1: Dlhodobý majetok → 2: Celkové aktíva → 3: Vlastné imanie, 4: Krátkodobé záväzky, 5: Dlhodobé záväzky, 6: Ostatné pasíva
    const labels = [
      "Obežný majetok", "Dlhodobý majetok",
      "Celkové aktíva",
      "Vlastné imanie", "Krátkodobé záväzky", "Dlhodobé záväzky", "Ostatné pasíva",
    ];
    const colors = [
      "#10b981", "#0ea5e9",
      "#64748b",
      "#10b981", "#e11d48", "#e11d48", "#e11d48",
    ];

    const links: { source: number; target: number; value: number }[] = [];
    const lColors: string[] = [];

    if (current > 0) { links.push({ source: 0, target: 2, value: current }); lColors.push("rgba(16,185,129,0.3)"); }
    if (nonCurrent > 0) { links.push({ source: 1, target: 2, value: nonCurrent }); lColors.push("rgba(14,165,233,0.3)"); }

    if (equity > 0) { links.push({ source: 2, target: 3, value: equity }); lColors.push("rgba(16,185,129,0.3)"); }
    if (shortLiab > 0) { links.push({ source: 2, target: 4, value: shortLiab }); lColors.push("rgba(244,63,94,0.3)"); }
    if (longLiab > 0) { links.push({ source: 2, target: 5, value: longLiab }); lColors.push("rgba(244,63,94,0.3)"); }
    if (ostatnePasiva > 0) { links.push({ source: 2, target: 6, value: ostatnePasiva }); lColors.push("rgba(244,63,94,0.3)"); }

    const labelLeft = [true, true, true, false, false, false, false];

    const nodes = labels.map(name => ({ name }));
    return { sankeyData: { nodes, links }, nodeColors: colors, linkColors: lColors, nodeLabelLeft: labelLeft };
  }, [data]);

  if (!sankeyData) {
    return (
      <div className="flex items-center justify-center h-[300px] text-sm" style={{ color: "var(--text-muted)" }}>
        Údaje o súvahy nie sú dostupné
      </div>
    );
  }

  const incomingValue: Record<number, number> = {};
  const outgoingValue: Record<number, number> = {};
  for (const link of sankeyData.links) {
    outgoingValue[link.source] = (outgoingValue[link.source] || 0) + link.value;
    incomingValue[link.target] = (incomingValue[link.target] || 0) + link.value;
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <Sankey
        data={sankeyData}
        nodePadding={18}
        nodeWidth={8}
        linkCurvature={0.4}
        margin={{ top: 10, right: 130, bottom: 10, left: 130 }}
        node={(props: any) => {
          const { x, y, width, height, index } = props;
          const color = nodeColors[index] || "#94a3b8";
          const name = sankeyData.nodes[index]?.name || "";
          const isLeft = nodeLabelLeft[index] ?? false;
          const hasOutgoing = outgoingValue[index] !== undefined;
          const value = hasOutgoing ? (outgoingValue[index] || 0) : (incomingValue[index] || 0);
          const labelX = isLeft ? x - 10 : x + width + 10;
          const textAnchor = isLeft ? "end" : "start";
          return (
            <Layer key={`node-${index}`}>
              <rect x={x} y={y} width={width} height={height} fill={color} rx={3} />
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
                y={y + height / 2 + 13}
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
          const lColor = linkColors[index] || "#94a3b8";
          return (
            <Layer key={`link-${index}`}>
              <path
                d={`M${sourceX},${sourceY}C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
                stroke={lColor}
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
