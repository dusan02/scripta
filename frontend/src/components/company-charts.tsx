"use client";

import {
  BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, Sankey, Layer,
} from "recharts";
import { useEffect, useMemo, useState } from "react";
import { useT } from "@/components/LanguageProvider";
import { fmtEUR } from "@/lib/format";

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

  const fmtAxis = (v: number) => {
    const abs = Math.abs(v);
    if (abs >= 1e6) return `${(v / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
    if (abs >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
    if (v !== 0) return v.toFixed(0);
    return "0";
  };
  const tooltipStyle = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 };
  const axisColor = "var(--text-muted)";
  const gridColor = "var(--border)";
  const yAxisWidth = isPrint ? 38 : 45;
  const margin = isPrint ? { top: 0, right: 10, left: 0, bottom: 0 } : { top: 0, right: 5, left: -5, bottom: 0 };

  // Detect scale mismatch: if revenue is >10x profit, split into two charts
  const revValues = data.map(d => Math.abs(d.tržby ?? 0)).filter(v => v > 0);
  const profitValues = data.map(d => Math.abs(d.zisk ?? 0)).filter(v => v > 0);
  const maxRev = revValues.length ? Math.max(...revValues) : 0;
  const maxProfit = profitValues.length ? Math.max(...profitValues) : 0;
  const needsSplit = maxRev > 0 && maxProfit > 0 && maxRev / maxProfit > 10;

  if (needsSplit) {
    // Split: top chart = revenue, bottom chart = profit + tax (separate Y scales)
    const revDomain: [number, number] = [0, maxRev * 1.1];
    const profitVals = data.flatMap(d => [d.zisk, d.daň].filter((v): v is number => v != null));
    const pMax = profitVals.length ? Math.max(...profitVals) : 0;
    const pMin = profitVals.length ? Math.min(...profitVals) : 0;
    // Ensure small values remain visible: if the range is extreme (max/min > 50x median),
    // add a minimum visible threshold so bars with small values are still perceptible
    const absProfitVals = profitVals.map(v => Math.abs(v)).filter(v => v > 0).sort((a, b) => a - b);
    const medianProfit = absProfitVals.length > 0 ? absProfitVals[Math.floor(absProfitVals.length / 2)] : 0;
    const extremeRange = medianProfit > 0 && (Math.abs(pMax) > medianProfit * 50 || Math.abs(pMin) > medianProfit * 50);
    // If extreme range, clamp domain to ±max(|pMax|,|pMin|) but set min bar height via minPointSize on Bar
    const profitDomain: [number, number] = [pMin < 0 ? pMin * 1.1 : 0, pMax > 0 ? pMax * 1.1 : 100];
    // minPointSize ensures even tiny values get a visible bar (2px minimum)
    const profitMinPointSize = extremeRange ? 3 : 0;

    return (
      <div>
        <div className={`flex gap-3 mb-2 ${isPrint ? "justify-center" : "flex-wrap justify-center"}`}>
          {LEGEND_ITEMS.map(item => (
            <button key={item.key} onClick={() => toggle(item.key)} className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ opacity: hidden.has(item.key) ? 0.4 : 1, color: axisColor }}>
              <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: item.color }} />
              {item.label}
            </button>
          ))}
        </div>
        {/* Revenue chart */}
        {!hidden.has("tržby") && (
          <ResponsiveContainer width="100%" height={isPrint ? 100 : 110} minHeight={isPrint ? 100 : 110}>
            <BarChart data={data} margin={margin} barCategoryGap="20%">
              <XAxis dataKey="year" tick={{ fill: axisColor, fontSize: isPrint ? 9 : 11 }} axisLine={{ stroke: gridColor }} tickLine={false} />
              <YAxis domain={revDomain} tickFormatter={fmtAxis} tick={{ fill: axisColor, fontSize: isPrint ? 8 : 10 }} axisLine={false} tickLine={false} width={yAxisWidth} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => fmtEUR(v as number)} cursor={{ fill: "var(--border)", opacity: 0.3 }} />
              <Bar dataKey="tržby" fill="#3b82f6" radius={[3, 3, 0, 0]} name={t("firma.trzby")} />
            </BarChart>
          </ResponsiveContainer>
        )}
        {/* Profit + Tax chart */}
        <ResponsiveContainer width="100%" height={isPrint ? 120 : 140} minHeight={isPrint ? 120 : 140}>
          <BarChart data={data} margin={margin} barGap={2} barCategoryGap="20%">
            <XAxis dataKey="year" tick={{ fill: axisColor, fontSize: isPrint ? 9 : 11 }} axisLine={{ stroke: gridColor }} tickLine={false} />
            <YAxis domain={profitDomain} tickFormatter={fmtAxis} tick={{ fill: axisColor, fontSize: isPrint ? 8 : 10 }} axisLine={false} tickLine={false} width={yAxisWidth} />
            <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => fmtEUR(v as number)} cursor={{ fill: "var(--border)", opacity: 0.3 }} />
            <ReferenceLine y={0} stroke="var(--text-muted)" strokeWidth={1} strokeOpacity={0.5} />
            <Bar dataKey="zisk" name={t("firma.ziskStrata")} radius={[3, 3, 0, 0]} hide={hidden.has("zisk")} minPointSize={profitMinPointSize}>
              {data.map((d, i) => {
                const v = d.zisk;
                const color = v == null ? "transparent" : v >= 0 ? "#10b981" : "#ef4444";
                return <Cell key={i} fill={color} />;
              })}
            </Bar>
            <Bar dataKey="daň" fill="#f59e0b" radius={[3, 3, 0, 0]} name={t("firma.danZPrjimu")} hide={hidden.has("daň")} minPointSize={profitMinPointSize} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // Single chart (normal scale)
  const visibleKeys = ["tržby", "zisk", "daň"].filter(k => !hidden.has(k));
  const allValues = data.flatMap(d => visibleKeys.map(k => d[k as keyof ChartData] as number | null)).filter((v): v is number => v != null);
  const maxVal = allValues.length ? Math.max(...allValues) : 0;
  const minVal = allValues.length ? Math.min(...allValues) : 0;
  const yMax = maxVal > 0 ? maxVal * 1.1 : 100;
  const yMin = minVal < 0 ? minVal * 1.1 : 0;

  return (
    <div>
      <div className={`flex gap-3 mb-2 ${isPrint ? "justify-center" : "flex-wrap justify-center"}`}>
        {LEGEND_ITEMS.map(item => (
          <button
            key={item.key}
            onClick={() => toggle(item.key)}
            className="flex items-center gap-1.5 text-xs cursor-pointer"
            style={{ opacity: hidden.has(item.key) ? 0.4 : 1, color: axisColor }}
          >
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: item.color }} />
            {item.label}
          </button>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={isPrint ? 220 : 250} minHeight={isPrint ? 220 : 250}>
        <BarChart data={data} margin={margin} barGap={2} barCategoryGap="20%">
          <XAxis dataKey="year" tick={{ fill: axisColor, fontSize: isPrint ? 9 : 11 }} axisLine={{ stroke: gridColor }} tickLine={false} />
          <YAxis domain={[yMin, yMax]} tickFormatter={fmtAxis} tick={{ fill: axisColor, fontSize: isPrint ? 8 : 10 }} axisLine={false} tickLine={false} width={yAxisWidth} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => fmtEUR(v as number)} cursor={{ fill: "var(--border)", opacity: 0.3 }} />
          <ReferenceLine y={0} stroke="var(--text-muted)" strokeWidth={1} strokeOpacity={0.5} />
          <Bar dataKey="tržby" fill="#3b82f6" radius={[3, 3, 0, 0]} name={t("firma.trzby")} hide={hidden.has("tržby")} />
          <Bar dataKey="zisk" name={t("firma.ziskStrata")} radius={[3, 3, 0, 0]} hide={hidden.has("zisk")}>
            {data.map((d, i) => {
              const v = d.zisk;
              const color = v == null ? "transparent" : v >= 0 ? "#10b981" : "#ef4444";
              return <Cell key={i} fill={color} />;
            })}
          </Bar>
          <Bar dataKey="daň" fill="#f59e0b" radius={[3, 3, 0, 0]} name={t("firma.danZPrjimu")} hide={hidden.has("daň")} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BalanceSankeyChart({ data }: { data: BalanceData }) {
  const t = useT();
  const isPrint = useIsPrint();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [hoveredType, setHoveredType] = useState<"node" | "link" | null>(null);

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

  // Compute which links are connected to a hovered node
  const activeLinkIndices = useMemo(() => {
    if (hoveredType !== "node" || hoveredIndex === null) return null;
    const indices = new Set<number>();
    sankeyData.links.forEach((l, i) => {
      if (l.source === hoveredIndex || l.target === hoveredIndex) indices.add(i);
    });
    return indices;
  }, [hoveredType, hoveredIndex, sankeyData.links]);

  const isLinkActive = (linkIdx: number) => {
    if (hoveredType === "link") return hoveredIndex === linkIdx;
    if (hoveredType === "node" && activeLinkIndices) return activeLinkIndices.has(linkIdx);
    return true;
  };

  const isNodeActive = (nodeIdx: number) => {
    if (hoveredType === "node") return hoveredIndex === nodeIdx;
    if (hoveredType === "link" && hoveredIndex !== null) {
      const link = sankeyData.links[hoveredIndex];
      return link && (link.source === nodeIdx || link.target === nodeIdx);
    }
    return true;
  };

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
          const active = isNodeActive(index);
          const dim = hoveredType !== null && !active;
          const nodeOpacity = dim ? 0.25 : active && hoveredType === "node" ? 1 : 0.85;

          // Center node: render bar only, no label
          if (isCenter) {
            return (
              <Layer key={`node-${index}`}>
                <rect
                  x={x} y={y} width={width} height={height}
                  fill={color} rx={3} opacity={nodeOpacity}
                  style={{ cursor: "pointer", transition: "opacity 0.2s" }}
                  onMouseEnter={() => { setHoveredIndex(index); setHoveredType("node"); }}
                  onMouseLeave={() => { setHoveredIndex(null); setHoveredType(null); }}
                >
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
              <rect
                x={x} y={y} width={width} height={height}
                fill={color} rx={3} opacity={nodeOpacity}
                style={{ cursor: "pointer", transition: "opacity 0.2s" }}
                onMouseEnter={() => { setHoveredIndex(index); setHoveredType("node"); }}
                onMouseLeave={() => { setHoveredIndex(null); setHoveredType(null); }}
              >
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
                    opacity={dim ? 0.3 : 1}
                    style={{ pointerEvents: "none", transition: "opacity 0.2s" }}
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
                      opacity={dim ? 0.3 : 1}
                      style={{ pointerEvents: "none", transition: "opacity 0.2s" }}
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
          const active = isLinkActive(index);
          const linkOpacity = hoveredType === null ? 1 : active ? 0.9 : 0.12;

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
                opacity={linkOpacity}
                style={{ cursor: "pointer", transition: "opacity 0.2s" }}
                onMouseEnter={() => { setHoveredIndex(index); setHoveredType("link"); }}
                onMouseLeave={() => { setHoveredIndex(null); setHoveredType(null); }}
              >
                <title>{linkTitle}</title>
              </path>
            </Layer>
          );
        }}
      >
      </Sankey>
    </ResponsiveContainer>
  );
}
