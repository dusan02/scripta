"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Sankey, Layer,
} from "recharts";
import { useEffect, useMemo, useState } from "react";
import { useT } from "@/components/LanguageProvider";

function useIsPrint() {
  const [isPrint, setIsPrint] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("print");
    const update = () => setIsPrint(mq.matches);
    update();
    mq.addEventListener("change", update);
    const before = () => setIsPrint(true);
    const after = () => setIsPrint(false);
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      mq.removeEventListener("change", update);
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);
  return isPrint;
}

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
  daň: number | null;
  aktíva: number | null;
  vlastnéImanie: number | null;
};

type BalanceData = {
  currentAssets: number | null;
  totalAssets: number | null;
  equity: number | null;
  shortTermLiabilities: number | null;
  longTermLiabilities: number | null;
};

export function RevenueProfitChart({ data }: { data: ChartData[] }) {
  const t = useT();
  const isPrint = useIsPrint();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const toggle = (key: string) => setHidden(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const LEGEND_ITEMS = [
    { key: "tržby", color: "#3b82f6", label: t("firma.trzby") },
    { key: "zisk", color: "#10b981", label: t("firma.ziskStrata") },
    { key: "daň", color: "#f59e0b", label: t("firma.danZPrjimu") },
  ];

  return (
    <div>
      <div className={`flex gap-3 mb-2 ${isPrint ? "justify-center" : "flex-wrap"}`}>
        {LEGEND_ITEMS.map(item => (
          <button
            key={item.key}
            onClick={() => toggle(item.key)}
            className="flex items-center gap-1.5 text-xs cursor-pointer"
            style={{ opacity: hidden.has(item.key) ? 0.4 : 1, color: "var(--text-muted)" }}
          >
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: item.color }} />
            {item.label}
          </button>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={isPrint ? 220 : 240} minHeight={isPrint ? 220 : 240}>
        <BarChart data={data} margin={isPrint ? { top: 0, right: 40, left: 40, bottom: 0 } : { top: 0, right: 0, left: -15, bottom: 0 }}>
          <XAxis dataKey="year" tick={{ fill: "var(--text-muted)", fontSize: isPrint ? 9 : 11 }} axisLine={{ stroke: "var(--border)" }} />
          <YAxis tickFormatter={(v: number) => v >= 1e6 ? `${(v/1e6).toFixed(0)}M` : v >= 1e3 ? `${(v/1e3).toFixed(0)}k` : ""} tick={{ fill: "var(--text-muted)", fontSize: isPrint ? 8 : 10 }} axisLine={{ stroke: "var(--border)" }} width={isPrint ? 35 : 45} />
          <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} formatter={(v: any) => fmtEUR(v as number)} />
          <Bar dataKey="tržby" fill="#3b82f6" radius={[4, 4, 0, 0]} name={t("firma.trzby")} hide={hidden.has("tržby")} />
          <Bar dataKey="zisk" fill="#10b981" radius={[4, 4, 0, 0]} name={t("firma.ziskStrata")} hide={hidden.has("zisk")} />
          <Bar dataKey="daň" fill="#f59e0b" radius={[4, 4, 0, 0]} name={t("firma.danZPrjimu")} hide={hidden.has("daň")} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BalanceSankeyChart({ data }: { data: BalanceData }) {
  const t = useT();
  const isPrint = useIsPrint();
  const { sankeyData } = useMemo(() => {
    const current = Math.max(0, data.currentAssets ?? 0);
    const rawTotalAssets = Math.max(0, data.totalAssets ?? 0);
    const nonCurrent = Math.max(0, rawTotalAssets - current);
    
    const equityVal = data.equity ?? 0;
    const isNegativeEquity = equityVal < 0;
    const absEquity = Math.abs(equityVal);
    
    const shortLiab = Math.max(0, data.shortTermLiabilities ?? 0);
    const longLiab = Math.max(0, data.longTermLiabilities ?? 0);

    const leftNodes = [];
    if (current > 0) leftNodes.push({ name: t("firma.obeznyMajetok"), value: current, color: "#10b981", linkColor: "rgba(16,185,129,0.3)" });
    if (nonCurrent > 0) leftNodes.push({ name: t("firma.dlhodobyMajetok"), value: nonCurrent, color: "#0ea5e9", linkColor: "rgba(14,165,233,0.3)" });
    if (isNegativeEquity && absEquity > 0) leftNodes.push({ name: t("firma.zaporneImanie"), value: absEquity, color: "#ef4444", linkColor: "rgba(239,68,68,0.3)" });

    const rightNodes = [];
    if (!isNegativeEquity && absEquity > 0) rightNodes.push({ name: t("firma.vlastneImanie"), value: absEquity, color: "#10b981", linkColor: "rgba(16,185,129,0.3)" });
    if (shortLiab > 0) rightNodes.push({ name: t("firma.kratkodobeZavazky"), value: shortLiab, color: "#f43f5e", linkColor: "rgba(244,63,94,0.3)" });
    if (longLiab > 0) rightNodes.push({ name: t("firma.dlhodobeZavazky"), value: longLiab, color: "#f43f5e", linkColor: "rgba(244,63,94,0.3)" });

    const leftSum = leftNodes.reduce((sum, n) => sum + n.value, 0);
    const rightSum = rightNodes.reduce((sum, n) => sum + n.value, 0);
    const centerValue = Math.max(leftSum, rightSum, rawTotalAssets);

    if (leftSum < centerValue) {
      leftNodes.push({ name: t("firma.ostatneAktiva"), value: centerValue - leftSum, color: "#94a3b8", linkColor: "rgba(148,163,184,0.3)" });
    }
    if (rightSum < centerValue) {
      rightNodes.push({ name: t("firma.ostatnePasiva"), value: centerValue - rightSum, color: "#64748b", linkColor: "rgba(100,116,139,0.3)" });
    }

    const nodes: { name: string; color: string; isLeft: boolean; isCenter?: boolean }[] = [];
    const links: { source: number; target: number; value: number; lColor: string; srcName?: string; tgtName?: string }[] = [];

    // Left nodes
    leftNodes.forEach(n => {
      nodes.push({ name: n.name, color: n.color, isLeft: true });
    });

    // Center node — no label (it's a conduit, label would overlap links)
    const centerIndex = nodes.length;
    nodes.push({ name: "", color: "#64748b", isLeft: true, isCenter: true });

    // Right nodes
    const rightStartIndex = nodes.length;
    rightNodes.forEach(n => {
      nodes.push({ name: n.name, color: n.color, isLeft: false });
    });

    // Add links
    leftNodes.forEach((n, i) => {
      if (n.value > 0) {
        links.push({ source: i, target: centerIndex, value: n.value, lColor: n.linkColor, srcName: n.name, tgtName: t("firma.bilancnaSuma") });
      }
    });

    rightNodes.forEach((n, i) => {
      if (n.value > 0) {
        links.push({ source: centerIndex, target: rightStartIndex + i, value: n.value, lColor: n.linkColor, srcName: t("firma.bilancnaSuma"), tgtName: n.name });
      }
    });

    return { sankeyData: { nodes, links } };
  }, [data, t]);

  if (!sankeyData || sankeyData.links.length === 0) {
    return (
      <div className="flex items-center justify-center h-[250px] sm:h-[300px] text-sm" style={{ color: "var(--text-muted)" }}>
        {t("firma.udajeNedostupne")}
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
    <ResponsiveContainer width="100%" height={isPrint ? 280 : 310} minHeight={isPrint ? 280 : 310}>
      <Sankey
        data={sankeyData}
        nodePadding={isPrint ? 8 : 18}
        nodeWidth={8}
        linkCurvature={0.4}
        margin={isPrint ? { top: 5, right: 60, bottom: 5, left: 60 } : { top: 10, right: 80, bottom: 10, left: 80 }}
        node={(props: any) => {
          const { x, y, width, height, index, payload } = props;
          const color = payload?.color || "#94a3b8";
          const name = payload?.name || "";
          const isLeft = payload?.isLeft ?? false;
          const isCenter = payload?.isCenter ?? false;
          const hasOutgoing = outgoingValue[index] !== undefined;
          const value = hasOutgoing ? (outgoingValue[index] || 0) : (incomingValue[index] || 0);

          // Center node: render bar only, no label (label would overlap links)
          if (isCenter) {
            return (
              <Layer key={`node-${index}`}>
                <rect x={x} y={y} width={width} height={height} fill={color} rx={3} />
              </Layer>
            );
          }

          const labelX = isLeft ? x - 6 : x + width + 6;
          const textAnchor = isLeft ? "end" : "start";
          const words = name.split(" ");
          const isMultiLine = words.length >= 2;
          const line1 = isMultiLine ? words[0] : name;
          const line2 = isMultiLine ? words.slice(1).join(" ") : "";

          return (
            <Layer key={`node-${index}`}>
              <rect x={x} y={y} width={width} height={height} fill={color} rx={3} />
              <text
                x={labelX}
                y={y + height / 2 - (isMultiLine ? 6 : 0)}
                dy=".35em"
                textAnchor={textAnchor}
                fontSize={isPrint ? 8 : 10}
                fill="var(--text)"
              >
                <tspan x={labelX} dy="0">{line1}</tspan>
                {isMultiLine && <tspan x={labelX} dy="1.1em">{line2}</tspan>}
              </text>
              <text
                x={labelX}
                y={y + height / 2 + (isMultiLine ? 14 : 11)}
                dy=".35em"
                textAnchor={textAnchor}
                fontSize={isPrint ? 7 : 9}
                fill="var(--text-muted)"
              >
                {fmtEUR(value)}
              </text>
            </Layer>
          );
        }}
        link={(props: any) => {
          const { sourceX, targetX, sourceY, targetY, sourceControlX, targetControlX, linkWidth, index, payload } = props;
          const lColor = payload?.lColor || "#94a3b8";
          const halfWidth = Math.max(0.5, linkWidth / 2);
          
          const path = `
            M${sourceX},${sourceY - halfWidth}
            C${sourceControlX},${sourceY - halfWidth} ${targetControlX},${targetY - halfWidth} ${targetX},${targetY - halfWidth}
            L${targetX},${targetY + halfWidth}
            C${targetControlX},${targetY + halfWidth} ${sourceControlX},${sourceY + halfWidth} ${sourceX},${sourceY + halfWidth}
            Z
          `;

          return (
            <Layer key={`link-${index}`}>
              <path
                d={path}
                fill={lColor}
                stroke="none"
              />
            </Layer>
          );
        }}
      >
        <Tooltip
          contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
          formatter={(v: any, _name: any, props: any) => {
            const payload = props?.payload;
            if (payload?.srcName && payload?.tgtName) {
              return [fmtEUR(v as number), `${payload.srcName} → ${payload.tgtName}`];
            }
            return [fmtEUR(v as number), ""];
          }}
        />
      </Sankey>
    </ResponsiveContainer>
  );
}
