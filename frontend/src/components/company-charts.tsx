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
  const { sankeyData, nodeColors, nodeLevels } = useMemo(() => {
    const cash = data.cash ?? 0;
    const receivables = data.receivables ?? 0;
    const inventory = data.inventory ?? 0;
    const current = data.currentAssets ?? 0;
    const totalAssets = data.totalAssets ?? 0;
    const equity = Math.max(0, data.equity ?? 0);
    const shortLiab = data.shortTermLiabilities ?? 0;
    const longLiab = data.longTermLiabilities ?? 0;

    if (totalAssets <= 0) return { sankeyData: null, nodeColors: [] as string[], nodeLevels: [] as number[] };

    const nonCurrent = Math.max(0, totalAssets - current);
    const rawComponents = cash + receivables + inventory;
    let otherCurrent: number;
    let scaledCash = cash, scaledRec = receivables, scaledInv = inventory;
    if (rawComponents > current && rawComponents > 0) {
      const scale = current / rawComponents;
      scaledCash = cash * scale;
      scaledRec = receivables * scale;
      scaledInv = inventory * scale;
      otherCurrent = 0;
    } else if (rawComponents === 0 && current > 0) {
      otherCurrent = current;
    } else {
      otherCurrent = Math.max(0, current - rawComponents);
    }

    const knownLiab = shortLiab + longLiab;
    const ostatnePasiva = Math.max(0, totalAssets - equity - knownLiab);
    const liabFlow = knownLiab + ostatnePasiva;

    // Node indices:
    // 0: Hotovosť, 1: Pohľadávky, 2: Zásoby, 3: Ostat. obež. maj.
    // 4: Obežný majetok, 5: Dlhodobý majetok
    // 6: Celkové aktíva
    // 7: Záväzky, 8: Vlastné imanie
    // 9: Krátkodobé záväzky, 10: Dlhodobé záväzky, 11: Ostatné pasíva
    const labels = [
      "Hotovosť", "Pohľadávky", "Zásoby", "Ostat. obež. maj.",
      "Obežný majetok", "Dlhodobý majetok",
      "Celkové aktíva",
      "Záväzky", "Vlastné imanie",
      "Krátkodobé záväzky", "Dlhodobé záväzky", "Ostatné pasíva",
    ];
    const colors = [
      "#6ee7b7", "#6ee7b7", "#6ee7b7", "#6ee7b7",
      "#10b981", "#0ea5e9",
      "#64748b",
      "#f43f5e", "#10b981",
      "#e11d48", "#e11d48", "#e11d48",
    ];
    // Level: 0=leftmost, 1=middle-left, 2=center, 3=middle-right, 4=rightmost
    const levels = [0, 0, 0, 0, 1, 1, 2, 3, 3, 4, 4, 4];

    const links: { source: number; target: number; value: number }[] = [];
    const linkColors: string[] = [];

    // Left: components → Obežný majetok
    if (scaledCash > 0) { links.push({ source: 0, target: 4, value: scaledCash }); linkColors.push("rgba(16,185,129,0.25)"); }
    if (scaledRec > 0) { links.push({ source: 1, target: 4, value: scaledRec }); linkColors.push("rgba(16,185,129,0.25)"); }
    if (scaledInv > 0) { links.push({ source: 2, target: 4, value: scaledInv }); linkColors.push("rgba(16,185,129,0.25)"); }
    if (otherCurrent > 0) { links.push({ source: 3, target: 4, value: otherCurrent }); linkColors.push("rgba(16,185,129,0.25)"); }

    // Middle: Obežný + Dlhodobý → Celkové aktíva
    if (current > 0) { links.push({ source: 4, target: 6, value: current }); linkColors.push("rgba(16,185,129,0.35)"); }
    if (nonCurrent > 0) { links.push({ source: 5, target: 6, value: nonCurrent }); linkColors.push("rgba(14,165,233,0.35)"); }

    // Right: Celkové aktíva → Záväzky + Vlastné imanie
    if (liabFlow > 0) { links.push({ source: 6, target: 7, value: liabFlow }); linkColors.push("#fecaca"); }
    if (equity > 0) { links.push({ source: 6, target: 8, value: equity }); linkColors.push("rgba(16,185,129,0.35)"); }

    // Far right: Záväzky → sub-categories
    if (shortLiab > 0) { links.push({ source: 7, target: 9, value: shortLiab }); linkColors.push("#fca5a5"); }
    if (longLiab > 0) { links.push({ source: 7, target: 10, value: longLiab }); linkColors.push("#fca5a5"); }
    if (ostatnePasiva > 0) { links.push({ source: 7, target: 11, value: ostatnePasiva }); linkColors.push("#fca5a5"); }

    const nodes = labels.map(name => ({ name }));
    return { sankeyData: { nodes, links }, nodeColors: colors, nodeLevels: levels };
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
        nodePadding={10}
        nodeWidth={6}
        linkCurvature={0.5}
        margin={{ top: 10, right: 110, bottom: 10, left: 110 }}
        node={(props: any) => {
          const { x, y, width, height, index } = props;
          const color = nodeColors[index] || "#94a3b8";
          const name = sankeyData.nodes[index]?.name || "";
          const level = nodeLevels[index] || 0;
          const hasIncoming = incomingValue[index] !== undefined;
          const hasOutgoing = outgoingValue[index] !== undefined;
          const value = hasOutgoing ? (outgoingValue[index] || 0) : (incomingValue[index] || 0);
          const isLeft = level <= 2;
          const labelX = isLeft ? x - 8 : x + width + 8;
          const textAnchor = isLeft ? "end" : "start";
          return (
            <Layer key={`node-${index}`}>
              <rect x={x} y={y} width={width} height={height} fill={color} rx={2} />
              <text
                x={labelX}
                y={y + height / 2}
                dy=".35em"
                textAnchor={textAnchor}
                fontSize={10}
                fill="var(--text)"
              >
                {name}
              </text>
              <text
                x={labelX}
                y={y + height / 2 + 12}
                dy=".35em"
                textAnchor={textAnchor}
                fontSize={9}
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
            <Layer key={`link-${index}`} opacity={0.3}>
              <path
                d={`M${sourceX},${sourceY}C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
                stroke={color}
                strokeWidth={Math.max(0.5, linkWidth)}
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
