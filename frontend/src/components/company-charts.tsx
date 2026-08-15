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
  nonCurrentAssets: number | null;
  totalAssets: number | null;
  equity: number | null;
  shortTermLiabilities: number | null;
  longTermLiabilities: number | null;
  // Detailed asset breakdown
  intangibleAssets: number | null;
  tangibleAssets: number | null;
  ltFinancialAssets: number | null;
  ltReceivables: number | null;
  inventory: number | null;
  tradeReceivables: number | null;
  stFinancialAssets: number | null;
  cashAndEquivalents: number | null;
  deferredAssets: number | null;
  // Detailed equity breakdown
  shareCapital: number | null;
  sharePremium: number | null;
  otherCapitalFunds: number | null;
  statutoryReserveFunds: number | null;
  retainedEarnings: number | null;
  currentYearProfit: number | null;
  // Detailed liabilities breakdown
  ltReserves: number | null;
  stReserves: number | null;
  stBankLoans: number | null;
  stFinancialAssistance: number | null;
  tradePayables: number | null;
  socialInsuranceLiabilities: number | null;
  taxLiabilities: number | null;
  employeeLiabilities: number | null;
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
      <div className={`flex gap-3 mb-2 ${isPrint ? "justify-center" : "flex-wrap justify-center"}`}>
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
          <YAxis tickFormatter={(v: number) => v >= 1e6 ? `${(v/1e6).toFixed(0)}` : v >= 1e3 ? `${(v/1e3).toFixed(0)}` : ""} tick={{ fill: "var(--text-muted)", fontSize: isPrint ? 8 : 10 }} axisLine={{ stroke: "var(--border)" }} width={isPrint ? 30 : 35} />
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
    const rawTotalAssets = Math.max(0, data.totalAssets ?? 0);
    if (rawTotalAssets <= 0) return { sankeyData: { nodes: [], links: [] } };

    const pos = (v: number | null) => Math.max(0, v ?? 0);

    // ── Use DB aggregate values directly (matches table) ─────────
    const nonCurrentAssets = pos(data.nonCurrentAssets);
    const currentAssets = pos(data.currentAssets);

    // ── Right side: equity + liabilities (DB aggregates) ─────────
    const equityVal = data.equity ?? 0;
    const isNegativeEquity = equityVal < 0;
    const absEquity = Math.abs(equityVal);
    const shortLiab = pos(data.shortTermLiabilities);
    const longLiab = pos(data.longTermLiabilities);

    // ── Neutral corporate color palette ──────────────────────────
    // Assets: blues/teals | Equity: greens | Liabilities: neutral grays
    // Red reserved ONLY for negative equity
    const C = {
      nonCurrent: "#0ea5e9",
      current: "#06b6d4",
      equity: "#059669",
      shortLiab: "#64748b",
      longLiab: "#78716c",
      negEquity: "#ef4444",
      other: "#94a3b8",
    };

    const lc = (c: string, a: number) => c + Math.round(a * 255).toString(16).padStart(2, "0");

    type SNode = { name: string; color: string; isLeft: boolean; isCenter?: boolean };
    type SLink = { source: number; target: number; value: number; lColor: string; srcName?: string; tgtName?: string };
    const nodes: SNode[] = [];
    const links: SLink[] = [];

    // ═══════════════════════════════════════════════════════════════
    // LEFT: Asset aggregates (matches table: Neobežný / Obežný / Ostatné)
    // ═══════════════════════════════════════════════════════════════

    const leftItems: { name: string; value: number; color: string }[] = [];

    if (nonCurrentAssets > 0) {
      leftItems.push({ name: t("firma.neobeznyMajetok"), value: nonCurrentAssets, color: C.nonCurrent });
    }
    if (currentAssets > 0) {
      leftItems.push({ name: t("firma.obeznyMajetok"), value: currentAssets, color: C.current });
    }

    // Handle negative equity — shows on asset side
    if (isNegativeEquity && absEquity > 0) {
      leftItems.push({ name: t("firma.zaporneImanie"), value: absEquity, color: C.negEquity });
    }

    // Residual "Ostatné aktíva" = total - sum of known items
    const leftSum = leftItems.reduce((s, n) => s + n.value, 0);
    const otherAssetsVal = rawTotalAssets - leftSum;
    if (otherAssetsVal > 1) {
      leftItems.push({ name: t("firma.ostatneAktiva"), value: otherAssetsVal, color: C.other });
    }

    // Add left nodes
    leftItems.forEach(n => {
      nodes.push({ name: n.name, color: n.color, isLeft: true });
    });

    // ═══════════════════════════════════════════════════════════════
    // CENTER: Bilančná suma
    // ═══════════════════════════════════════════════════════════════

    const centerIndex = nodes.length;
    nodes.push({ name: "", color: "#475569", isLeft: true, isCenter: true });

    // Links: left → center
    leftItems.forEach((n, i) => {
      links.push({ source: i, target: centerIndex, value: n.value, lColor: lc(n.color, 0.25), srcName: n.name, tgtName: t("firma.bilancnaSuma") });
    });

    // ═══════════════════════════════════════════════════════════════
    // RIGHT: Equity + Liabilities (matches table)
    // ═══════════════════════════════════════════════════════════════

    const rightItems: { name: string; value: number; color: string }[] = [];

    if (!isNegativeEquity && absEquity > 0) {
      rightItems.push({ name: t("firma.vlastneImanie"), value: absEquity, color: C.equity });
    }
    if (shortLiab > 0) {
      rightItems.push({ name: t("firma.kratkodobeZavazky"), value: shortLiab, color: C.shortLiab });
    }
    if (longLiab > 0) {
      rightItems.push({ name: t("firma.dlhodobeZavazky"), value: longLiab, color: C.longLiab });
    }

    // Residual "Ostatné pasíva"
    const rightSum = rightItems.reduce((s, n) => s + n.value, 0);
    const otherLiabsVal = rawTotalAssets - rightSum;
    if (otherLiabsVal > 1) {
      rightItems.push({ name: t("firma.ostatnePasiva"), value: otherLiabsVal, color: C.other });
    }

    const rightStartIndex = nodes.length;
    rightItems.forEach(n => {
      nodes.push({ name: n.name, color: n.color, isLeft: false });
    });

    // Links: center → right
    rightItems.forEach((n, i) => {
      links.push({ source: centerIndex, target: rightStartIndex + i, value: n.value, lColor: lc(n.color, 0.25), srcName: t("firma.bilancnaSuma"), tgtName: n.name });
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
    <ResponsiveContainer width="100%" height={isPrint ? 300 : 350} minHeight={isPrint ? 300 : 350}>
      <Sankey
        data={sankeyData}
        nodePadding={isPrint ? 8 : 14}
        nodeWidth={8}
        linkCurvature={0.4}
        margin={isPrint ? { top: 8, right: 70, bottom: 8, left: 70 } : { top: 10, right: 90, bottom: 10, left: 90 }}
        node={(props: any) => {
          const { x, y, width, height, index } = props;
          const nodeData = sankeyData.nodes[index] || {};
          const color = nodeData.color || "#94a3b8";
          const isLeft = nodeData.isLeft ?? false;
          const isCenter = nodeData.isCenter ?? false;
          const name = nodeData.name || (isCenter ? t("firma.bilancnaSuma") : "");
          const hasOutgoing = outgoingValue[index] !== undefined;
          const value = hasOutgoing ? (outgoingValue[index] || 0) : (incomingValue[index] || 0);

          // Center node: render bar only, no label
          if (isCenter) {
            return (
              <Layer key={`node-${index}`}>
                <rect x={x} y={y} width={width} height={height} fill={color} rx={3}>
                  <title>{`${name}: ${fmtEUR(value)}`}</title>
                </rect>
              </Layer>
            );
          }

          const labelX = isLeft ? x - 6 : x + width + 6;
          const textAnchor = isLeft ? "end" : "start";
          const words = name.split(" ");
          const isMultiLine = words.length >= 2;
          const line1 = isMultiLine ? words[0] : name;
          const line2 = isMultiLine ? words.slice(1).join(" ") : "";

          // Always show name; show value only if node is tall enough (needs ~22px for both lines)
          const showName = true;
          const showValue = height >= (isPrint ? 16 : 22);

          return (
            <Layer key={`node-${index}`}>
              <rect x={x} y={y} width={width} height={height} fill={color} rx={3}>
                <title>{`${name}: ${fmtEUR(value)}`}</title>
              </rect>
              {showName && (
                <>
                  <text
                    x={labelX}
                    y={y + height / 2 - (showValue && isMultiLine ? 6 : 0)}
                    dy=".35em"
                    textAnchor={textAnchor}
                    fontSize={isPrint ? 8 : 10}
                    fill="var(--text)"
                  >
                    <tspan x={labelX} dy="0">{line1}</tspan>
                    {showValue && isMultiLine && <tspan x={labelX} dy="1.1em">{line2}</tspan>}
                  </text>
                  {showValue && (
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
                  )}
                </>
              )}
            </Layer>
          );
        }}
        link={(props: any) => {
          const { sourceX, targetX, sourceY, targetY, sourceControlX, targetControlX, linkWidth, index } = props;
          const linkData = sankeyData.links[index] || {};
          const lColor = linkData.lColor || "#94a3b8";
          const halfWidth = Math.max(0.5, linkWidth / 2);
          
          const path = `
            M${sourceX},${sourceY - halfWidth}
            C${sourceControlX},${sourceY - halfWidth} ${targetControlX},${targetY - halfWidth} ${targetX},${targetY - halfWidth}
            L${targetX},${targetY + halfWidth}
            C${targetControlX},${targetY + halfWidth} ${sourceControlX},${sourceY + halfWidth} ${sourceX},${sourceY + halfWidth}
            Z
          `;

          const linkTitle = linkData.srcName && linkData.tgtName
            ? `${linkData.srcName} → ${linkData.tgtName}: ${fmtEUR(linkData.value)}`
            : fmtEUR(linkData.value);

          return (
            <Layer key={`link-${index}`}>
              <path
                d={path}
                fill={lColor}
                stroke="none"
              >
                <title>{linkTitle}</title>
              </path>
            </Layer>
          );
        }}
      >
        <Tooltip
          cursor={false}
          contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, padding: "6px 10px" }}
          formatter={(_v: any, _name: any, props: any) => {
            const p = props?.payload;
            if (!p) return null as unknown as [string, string];
            // Link hover
            if (p.source != null && p.target != null && typeof p.index === "number") {
              const linkData = sankeyData.links[p.index];
              if (linkData?.srcName && linkData?.tgtName) {
                return [fmtEUR(linkData.value), `${linkData.srcName} → ${linkData.tgtName}`];
              }
            }
            // Node hover
            if (typeof p.index === "number" && sankeyData.nodes[p.index]) {
              const nd = sankeyData.nodes[p.index];
              const nodeName = nd.name || t("firma.bilancnaSuma");
              const val = outgoingValue[p.index] ?? incomingValue[p.index] ?? 0;
              return [fmtEUR(val), nodeName];
            }
            return null as unknown as [string, string];
          }}
        />
      </Sankey>
    </ResponsiveContainer>
  );
}
