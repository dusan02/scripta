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
  side: "aktiva" | "pasiva";
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
  const { sankeyData, nodeColors, nodeSides } = useMemo(() => {
    const aktiva = data.filter(d => d.side === "aktiva" && d.value !== null && d.value !== undefined && d.value > 0);
    const pasiva = data.filter(d => d.side === "pasiva" && d.value !== null && d.value !== undefined && d.value > 0);
    if (aktiva.length === 0 || pasiva.length === 0) return { sankeyData: null, nodeColors: [] as string[], nodeSides: [] as string[] };

    const nodes = [
      ...aktiva.map(d => ({ name: d.name })),
      ...pasiva.map(d => ({ name: d.name })),
    ];

    const aktivaTotal = aktiva.reduce((s, d) => s + (d.value as number), 0);
    const pasivaTotal = pasiva.reduce((s, d) => s + (d.value as number), 0);
    const links: { source: number; target: number; value: number }[] = [];

    for (let i = 0; i < aktiva.length; i++) {
      for (let j = 0; j < pasiva.length; j++) {
        const flow = (aktiva[i].value as number) * (pasiva[j].value as number) / Math.max(aktivaTotal, pasivaTotal);
        if (flow > 0) {
          links.push({ source: i, target: aktiva.length + j, value: flow });
        }
      }
    }

    const colors = [...aktiva.map(d => d.color), ...pasiva.map(d => d.color)];
    const sides = [...aktiva.map(() => "aktiva"), ...pasiva.map(() => "pasiva")];

    return { sankeyData: { nodes, links }, nodeColors: colors, nodeSides: sides };
  }, [data]);

  if (!sankeyData) {
    return (
      <div className="flex items-center justify-center h-[240px] text-sm" style={{ color: "var(--text-muted)" }}>
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
    <ResponsiveContainer width="100%" height={240}>
      <Sankey
        data={sankeyData}
        nodePadding={14}
        nodeWidth={8}
        linkCurvature={0.5}
        margin={{ top: 10, right: 100, bottom: 10, left: 100 }}
        node={(props: any) => {
          const { x, y, width, height, index } = props;
          const color = nodeColors[index] || "#94a3b8";
          const name = sankeyData.nodes[index]?.name || "";
          const side = nodeSides[index] || "pasiva";
          const value = side === "aktiva" ? (outgoingValue[index] || 0) : (incomingValue[index] || 0);
          const isLeft = side === "aktiva";
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
            <Layer key={`link-${index}`} opacity={0.25}>
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
