"use client";

import { useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useT } from "@/components/LanguageProvider";
import {
  type FinancialIndicatorRow,
  fmtPct,
  fmtRatio,
} from "@/lib/financial-indicators";

// ── Types ────────────────────────────────────────────────────────────────────

type PctSeriesKey = "debt" | "roe" | "roa" | "margin";

type PctSeriesConfig = {
  key: PctSeriesKey;
  label: string;
  color: string;
};

type Visibility = Record<PctSeriesKey, boolean>;

// ── Chart data adapter ───────────────────────────────────────────────────────
// Recharts expects { year, debt, roe, roa, margin } objects.
// Our FinancialIndicatorRow already matches this shape.

// ── Dynamic Y-axis domain ────────────────────────────────────────────────────

function computePctDomain(
  data: FinancialIndicatorRow[],
  visibleKeys: PctSeriesKey[],
): [number, number] | undefined {
  if (visibleKeys.length === 0) return undefined;

  const values: number[] = [];
  for (const row of data) {
    for (const key of visibleKeys) {
      const v = row[key];
      if (v != null) values.push(v * 100); // work in percentage points
    }
  }

  if (values.length === 0) return undefined;

  let min = Math.min(...values);
  let max = Math.max(...values);

  // If only one distinct value, expand around it
  if (min === max) {
    const pad = Math.max(Math.abs(min) * 0.1, 1);
    min -= pad;
    max += pad;
  }

  // Visual padding so lines don't touch the boundary
  const range = max - min;
  const pad = range * 0.1;
  min -= pad;
  max += pad;

  // Don't go below -100% or above 100% by default (debt can't exceed 100%,
  // but ROE can be very negative with negative equity — allow natural range)
  return [min, max];
}

function computeRatioDomain(
  data: FinancialIndicatorRow[],
): [number, number] | undefined {
  const values = data
    .map((d) => d.currentRatio)
    .filter((v): v is number => v != null);
  if (values.length === 0) return undefined;

  let min = Math.min(...values);
  let max = Math.max(...values);

  if (min === max) {
    const pad = Math.max(Math.abs(min) * 0.1, 0.1);
    min -= pad;
    max += pad;
  }

  const range = max - min;
  const pad = range * 0.1;
  min -= pad;
  max += pad;

  return [min, max];
}

// ── Custom tooltip ───────────────────────────────────────────────────────────

function PctTooltip({
  active,
  payload,
  label,
  series,
  visibility,
}: {
  active?: boolean;
  payload?: any[];
  label?: string | number;
  series: PctSeriesConfig[];
  visibility: Visibility;
}) {
  if (!active || !payload || payload.length === 0) return null;

  const visibleSeries = series.filter((s) => visibility[s.key]);

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "8px 10px",
        fontSize: 12,
        lineHeight: 1.6,
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 2 }}>{label}</div>
      {visibleSeries.map((s) => {
        const entry = payload.find((p: any) => p.dataKey === s.key);
        const v = entry?.value as number | null | undefined;
        return (
          <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: 2,
                background: s.color,
              }}
            />
            <span>{s.label}:</span>
            <span style={{ fontWeight: 600, marginLeft: "auto" }}>
              {v == null ? "—" : fmtPct(v)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function RatioTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: any[];
  label?: string | number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const v = payload[0]?.value as number | null | undefined;
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "8px 10px",
        fontSize: 12,
        lineHeight: 1.6,
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 2 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: 2,
            background: "#8b5cf6",
          }}
        />
        <span>Bežná likvidita:</span>
        <span style={{ fontWeight: 600, marginLeft: "auto" }}>
          {v == null ? "—" : fmtRatio(v)}
        </span>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function FinancialIndicatorsCharts({
  data,
}: {
  data: FinancialIndicatorRow[];
}) {
  const t = useT();

  const series: PctSeriesConfig[] = useMemo(
    () => [
      { key: "debt", label: t("firma.zadlzenost"), color: "#ef4444" },
      { key: "roe", label: "ROE", color: "#10b981" },
      { key: "roa", label: "ROA", color: "#3b82f6" },
      { key: "margin", label: "Zisková marža", color: "#f59e0b" },
    ],
    [t],
  );

  const [visibility, setVisibility] = useState<Visibility>({
    debt: true,
    roe: true,
    roa: true,
    margin: true,
  });

  const toggle = (key: PctSeriesKey) =>
    setVisibility((prev) => ({ ...prev, [key]: !prev[key] }));

  const visibleKeys = useMemo(
    () => series.filter((s) => visibility[s.key]).map((s) => s.key),
    [series, visibility],
  );

  const pctDomain = useMemo(
    () => computePctDomain(data, visibleKeys),
    [data, visibleKeys],
  );

  const ratioDomain = useMemo(
    () => computeRatioDomain(data),
    [data],
  );

  const hasVisibleSeries = visibleKeys.length > 0;
  const hasRatioData = data.some((d) => d.currentRatio != null);

  const axisColor = "var(--text-muted)";
  const gridColor = "var(--border)";
  const tooltipStyle = {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    fontSize: 12,
  };

  const pctTickFormatter = (v: number) => `${v.toFixed(0)}%`;
  const ratioTickFormatter = (v: number) => v.toFixed(2);

  return (
    <div className="flex flex-col gap-4">
      {/* ── Chart 1: Percentage metrics ─────────────────────────────────── */}
      <div>
        {/* Custom interactive legend */}
        <div
          className="flex flex-wrap gap-x-3 gap-y-1.5 mb-2"
          role="group"
          aria-label="Viditeľnosť ukazovateľov"
        >
          {series.map((s) => {
            const isVisible = visibility[s.key];
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => toggle(s.key)}
                aria-pressed={isVisible}
                className="flex items-center gap-1.5 text-xs cursor-pointer rounded px-1 py-0.5 transition-opacity"
                style={{
                  opacity: isVisible ? 1 : 0.4,
                  color: axisColor,
                  outlineOffset: 2,
                }}
                title={isVisible ? `Skryť ${s.label}` : `Zobraziť ${s.label}`}
              >
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm"
                  style={{
                    background: isVisible ? s.color : "var(--border)",
                    border: `1.5px solid ${s.color}`,
                  }}
                  aria-hidden="true"
                />
                {s.label}
              </button>
            );
          })}
        </div>

        {hasVisibleSeries ? (
          <ResponsiveContainer width="100%" height={220} minHeight={220}>
            <LineChart
              data={data}
              margin={{ top: 5, right: 10, left: -10, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke={gridColor}
                vertical={false}
                strokeOpacity={0.5}
              />
              <XAxis
                dataKey="year"
                tick={{ fill: axisColor, fontSize: 11 }}
                axisLine={{ stroke: gridColor }}
                tickLine={false}
              />
              <YAxis
                domain={pctDomain}
                tickFormatter={pctTickFormatter}
                tick={{ fill: axisColor, fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={42}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                content={
                  <PctTooltip
                    series={series}
                    visibility={visibility}
                  />
                }
                cursor={{ stroke: gridColor, strokeOpacity: 0.5 }}
              />
              {series.map((s) => (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  stroke={s.color}
                  strokeWidth={2}
                  dot={{ fill: s.color, r: 3, strokeWidth: 0 }}
                  activeDot={{ r: 5, strokeWidth: 0 }}
                  connectNulls={false}
                  hide={!visibility[s.key]}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div
            className="flex items-center justify-center text-xs"
            style={{
              height: 220,
              color: axisColor,
              border: `1px solid ${gridColor}`,
              borderRadius: 8,
            }}
          >
            Žiadne viditeľné ukazovatele — zapnite aspoň jeden v legende.
          </div>
        )}
      </div>

      {/* ── Chart 2: Bežná likvidita ────────────────────────────────────── */}
      <div>
        <h4
          className="text-xs font-semibold mb-1.5"
          style={{ color: axisColor }}
        >
          {t("firma.beznaLikvidita")}
        </h4>
        {hasRatioData ? (
          <ResponsiveContainer width="100%" height={140} minHeight={140}>
            <LineChart
              data={data}
              margin={{ top: 5, right: 10, left: -10, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke={gridColor}
                vertical={false}
                strokeOpacity={0.5}
              />
              <XAxis
                dataKey="year"
                tick={{ fill: axisColor, fontSize: 11 }}
                axisLine={{ stroke: gridColor }}
                tickLine={false}
              />
              <YAxis
                domain={ratioDomain}
                tickFormatter={ratioTickFormatter}
                tick={{ fill: axisColor, fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={42}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                content={<RatioTooltip />}
                cursor={{ stroke: gridColor, strokeOpacity: 0.5 }}
              />
              <Line
                type="monotone"
                dataKey="currentRatio"
                stroke="#8b5cf6"
                strokeWidth={2}
                dot={{ fill: "#8b5cf6", r: 3, strokeWidth: 0 }}
                activeDot={{ r: 5, strokeWidth: 0 }}
                connectNulls={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div
            className="flex items-center justify-center text-xs"
            style={{
              height: 140,
              color: axisColor,
              border: `1px solid ${gridColor}`,
              borderRadius: 8,
            }}
          >
            Údaje nedostupné
          </div>
        )}
      </div>
    </div>
  );
}
