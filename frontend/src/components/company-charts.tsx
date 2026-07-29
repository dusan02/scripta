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
    const cash = data.cash ?? 0;
    const receivables = data.receivables ?? 0;
    const inventory = data.inventory ?? 0;
    const current = data.currentAssets ?? 0;
    const totalAssets = data.totalAssets ?? 0;
    const equity = Math.max(0, data.equity ?? 0);
    const shortLiab = data.shortTermLiabilities ?? 0;
    const longLiab = data.longTermLiabilities ?? 0;

    if (totalAssets <= 0) return { sankeyData: null, nodeColors: [] as string[], linkColors: [] as string[], nodeLabelLeft: [] as boolean[] };

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

    const links: { source: number; target: number; value: number }[] = [];
    const lColors: string[] = [];

    if (scaledCash > 0) { links.push({ source: 0, target: 4, value: scaledCash }); lColors.push("rgba(16,185,129,0.25)"); }
    if (scaledRec > 0) { links.push({ source: 1, target: 4, value: scaledRec }); lColors.push("rgba(16,185,129,0.25)"); }
    if (scaledInv > 0) { links.push({ source: 2, target: 4, value: scaledInv }); lColors.push("rgba(16,185,129,0.25)"); }
    if (otherCurrent > 0) { links.push({ source: 3, target: 4, value: otherCurrent }); lColors.push("rgba(16,185,129,0.25)"); }

    if (current > 0) { links.push({ source: 4, target: 6, value: current }); lColors.push("rgba(16,185,129,0.35)"); }
    if (nonCurrent > 0) { links.push({ source: 5, target: 6, value: nonCurrent }); lColors.push("rgba(14,165,233,0.35)"); }

    if (liabFlow > 0) { links.push({ source: 6, target: 7, value: liabFlow }); lColors.push("#fecaca"); }
    if (equity > 0) { links.push({ source: 6, target: 8, value: equity }); lColors.push("rgba(16,185,129,0.35)"); }

    if (shortLiab > 0) { links.push({ source: 7, target: 9, value: shortLiab }); lColors.push("#fca5a5"); }
    if (longLiab > 0) { links.push({ source: 7, target: 10, value: longLiab }); lColors.push("#fca5a5"); }
    if (ostatnePasiva > 0) { links.push({ source: 7, target: 11, value: ostatnePasiva }); lColors.push("#fca5a5"); }

    // Fixed label positioning matching report's x coordinates:
    // Nodes 0-6: left side (label on left), Nodes 7-11: right side (label on right)
    const labelLeft = [true, true, true, true, true, true, true, false, false, false, false, false];

    const nodes = labels.map(name => ({ name }));
    return { sankeyData: { nodes, links }, nodeColors: colors, linkColors: lColors, nodeLabelLeft: labelLeft };
  }, [data]);

  if (!sankeyData) {
    return (
      <div className="flex items-center justify-center h-[350px] text-sm" style={{ color: "var(--text-muted)" }}>
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
    <ResponsiveContainer width="100%" height={350}>
      <Sankey
        data={sankeyData}
        nodePadding={8}
        nodeWidth={6}
        linkCurvature={0.5}
        margin={{ top: 10, right: 120, bottom: 10, left: 120 }}
        node={(props: any) => {
          const { x, y, width, height, index } = props;
          const color = nodeColors[index] || "#94a3b8";
          const name = sankeyData.nodes[index]?.name || "";
          const isLeft = nodeLabelLeft[index] ?? false;
          const hasOutgoing = outgoingValue[index] !== undefined;
          const value = hasOutgoing ? (outgoingValue[index] || 0) : (incomingValue[index] || 0);
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
          const lColor = linkColors[index] || "#94a3b8";
          return (
            <Layer key={`link-${index}`}>
              <path
                d={`M${sourceX},${sourceY}C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
                stroke={lColor}
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
