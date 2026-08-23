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
  fmtRatio,
} from "@/lib/financial-indicators";

// ── Types ────────────────────────────────────────────────────────────────────

type TopSeriesKey = "debt" | "roe" | "roa";
type BottomSeriesKey = "currentRatio" | "margin";

type SeriesConfig = {
  key: TopSeriesKey | BottomSeriesKey;
  label: string;
  color: string;
};

type TopVisibility = Record<TopSeriesKey, boolean>;
type BottomVisibility = Record<BottomSeriesKey, boolean>;

// ── Dynamic Y-axis domain ────────────────────────────────────────────────────

function computePctDomain(
  data: FinancialIndicatorRow[],
  keys: TopSeriesKey[],
): [number, number] | undefined {
  if (keys.length === 0) return undefined;

  const values: number[] = [];
  for (const row of data) {
    for (const key of keys) {
      const v = row[key];
      if (v != null) values.push(v * 100);
    }
  }

  if (values.length === 0) return undefined;

  let min = Math.min(...values);
  let max = Math.max(...values);

  if (min === max) {
    const pad = Math.max(Math.abs(min) * 0.1, 1);
    min -= pad;
    max += pad;
  }

  const range = max - min;
  const pad = range * 0.1;
  min -= pad;
  max += pad;

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

function computeMarginDomain(
  data: FinancialIndicatorRow[],
): [number, number] | undefined {
  const values = data
    .map((d) => d.margin)
    .filter((v): v is number => v != null)
    .map((v) => v * 100);
  if (values.length === 0) return undefined;

  let min = Math.min(...values);
  let max = Math.max(...values);

  if (min === max) {
    const pad = Math.max(Math.abs(min) * 0.1, 1);
    min -= pad;
    max += pad;
  }

  const range = max - min;
  const pad = range * 0.1;
  min -= pad;
  max += pad;

  return [min, max];
}

// ── Custom tooltips ──────────────────────────────────────────────────────────

function TopTooltip({
  active,
  payload,
  label,
  series,
  visibility,
}: {
  active?: boolean;
  payload?: any[];
  label?: string | number;
  series: SeriesConfig[];
  visibility: TopVisibility;
}) {
  if (!active || !payload || payload.length === 0) return null;

  const visibleSeries = series.filter((s) => visibility[s.key as TopSeriesKey]);

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
              {v == null ? "—" : `${v.toFixed(1)}%`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function BottomTooltip({
  active,
  payload,
  label,
  series,
  visibility,
}: {
  active?: boolean;
  payload?: any[];
  label?: string | number;
  series: SeriesConfig[];
  visibility: BottomVisibility;
}) {
  if (!active || !payload || payload.length === 0) return null;

  const visibleSeries = series.filter(
    (s) => visibility[s.key as BottomSeriesKey],
  );

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
        const isRatio = s.key === "currentRatio";
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
              {v == null
                ? "—"
                : isRatio
                  ? fmtRatio(v)
                  : `${v.toFixed(1)}%`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Legend button ────────────────────────────────────────────────────────────

function LegendButton({
  label,
  color,
  visible,
  onClick,
  axisColor,
}: {
  label: string;
  color: string;
  visible: boolean;
  onClick: () => void;
  axisColor: string;
}) {
  return (
    <button
      key={label}
      type="button"
      onClick={onClick}
      aria-pressed={visible}
      className="flex items-center gap-1.5 text-xs cursor-pointer rounded px-1 py-0.5 transition-opacity"
      style={{
        opacity: visible ? 1 : 0.4,
        color: axisColor,
        outlineOffset: 2,
      }}
      title={visible ? `Skryť ${label}` : `Zobraziť ${label}`}
    >
      <span
        className="inline-block w-2.5 h-2.5 rounded-sm"
        style={{
          background: visible ? color : "var(--border)",
          border: `1.5px solid ${color}`,
        }}
        aria-hidden="true"
      />
      {label}
    </button>
  );
}

// ── Shared constants ─────────────────────────────────────────────────────────

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

// ── Top chart: ROE, ROA, Zadlženosť ──────────────────────────────────────────

export function TopFinancialChart({
  data,
}: {
  data: FinancialIndicatorRow[];
}) {
  const t = useT();

  const topSeries: SeriesConfig[] = useMemo(
    () => [
      { key: "debt", label: t("firma.zadlzenost"), color: "#ef4444" },
      { key: "roe", label: "ROE", color: "#10b981" },
      { key: "roa", label: "ROA", color: "#3b82f6" },
    ],
    [t],
  );

  const [topVisibility, setTopVisibility] = useState<TopVisibility>({
    debt: true,
    roe: true,
    roa: true,
  });

  const toggleTop = (key: TopSeriesKey) =>
    setTopVisibility((prev) => ({ ...prev, [key]: !prev[key] }));

  const visibleTopKeys = useMemo(
    () => topSeries.filter((s) => topVisibility[s.key as TopSeriesKey]).map((s) => s.key as TopSeriesKey),
    [topSeries, topVisibility],
  );

  const pctDomain = useMemo(
    () => computePctDomain(data, visibleTopKeys),
    [data, visibleTopKeys],
  );

  const hasTopData = visibleTopKeys.length > 0;

  const topChartData = useMemo(
    () =>
      data.map((row) => ({
        year: row.year,
        debt: row.debt != null ? row.debt * 100 : null,
        roe: row.roe != null ? row.roe * 100 : null,
        roa: row.roa != null ? row.roa * 100 : null,
      })),
    [data],
  );

  return (
    <div>
      <div
        className="flex flex-wrap gap-x-3 gap-y-1.5 mb-2"
        role="group"
        aria-label="Viditeľnosť ukazovateľov"
      >
        {topSeries.map((s) => (
          <LegendButton
            key={s.key}
            label={s.label}
            color={s.color}
            visible={topVisibility[s.key as TopSeriesKey]}
            onClick={() => toggleTop(s.key as TopSeriesKey)}
            axisColor={axisColor}
          />
        ))}
      </div>

      {hasTopData ? (
        <ResponsiveContainer width="100%" height={220} minHeight={220}>
          <LineChart
            data={topChartData}
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
                <TopTooltip
                  series={topSeries}
                  visibility={topVisibility}
                />
              }
              cursor={{ stroke: gridColor, strokeOpacity: 0.5 }}
            />
            {topSeries.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={2}
                dot={{ fill: s.color, r: 3, strokeWidth: 0 }}
                activeDot={{ r: 5, strokeWidth: 0 }}
                connectNulls={false}
                hide={!topVisibility[s.key as TopSeriesKey]}
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
  );
}

// ── Bottom chart: Bežná likvidita + Zisková marža ────────────────────────────

export function BottomFinancialChart({
  data,
}: {
  data: FinancialIndicatorRow[];
}) {
  const t = useT();

  const bottomSeries: SeriesConfig[] = useMemo(
    () => [
      { key: "currentRatio", label: t("firma.beznaLikvidita"), color: "#8b5cf6" },
      { key: "margin", label: t("firma.ziskovaMarza"), color: "#f59e0b" },
    ],
    [t],
  );

  const [bottomVisibility, setBottomVisibility] = useState<BottomVisibility>({
    currentRatio: true,
    margin: true,
  });

  const toggleBottom = (key: BottomSeriesKey) =>
    setBottomVisibility((prev) => ({ ...prev, [key]: !prev[key] }));

  const ratioDomain = useMemo(
    () => computeRatioDomain(data),
    [data],
  );

  const marginDomain = useMemo(
    () => computeMarginDomain(data),
    [data],
  );

  const hasBottomData =
    data.some((d) => d.currentRatio != null) || data.some((d) => d.margin != null);

  const bottomChartData = useMemo(
    () =>
      data.map((row) => ({
        year: row.year,
        currentRatio: row.currentRatio,
        margin: row.margin != null ? row.margin * 100 : null,
      })),
    [data],
  );

  return (
    <div>
      <div
        className="flex flex-wrap gap-x-3 gap-y-1.5 mb-2"
        role="group"
        aria-label="Viditeľnosť ukazovateľov"
      >
        {bottomSeries.map((s) => (
          <LegendButton
            key={s.key}
            label={s.label}
            color={s.color}
            visible={bottomVisibility[s.key as BottomSeriesKey]}
            onClick={() => toggleBottom(s.key as BottomSeriesKey)}
            axisColor={axisColor}
          />
        ))}
      </div>

      {hasBottomData ? (
        <ResponsiveContainer width="100%" height={220} minHeight={220}>
          <LineChart
            data={bottomChartData}
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
            {/* Left Y-axis: Bežná likvidita (ratio) */}
            <YAxis
              yAxisId="ratio"
              domain={ratioDomain}
              tickFormatter={ratioTickFormatter}
              tick={{ fill: "#8b5cf6", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={42}
            />
            {/* Right Y-axis: Zisková marža (percentage) */}
            <YAxis
              yAxisId="pct"
              orientation="right"
              domain={marginDomain}
              tickFormatter={pctTickFormatter}
              tick={{ fill: "#f59e0b", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              width={42}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              content={
                <BottomTooltip
                  series={bottomSeries}
                  visibility={bottomVisibility}
                />
              }
              cursor={{ stroke: gridColor, strokeOpacity: 0.5 }}
            />
            <Line
              yAxisId="ratio"
              type="monotone"
              dataKey="currentRatio"
              stroke="#8b5cf6"
              strokeWidth={2}
              dot={{ fill: "#8b5cf6", r: 3, strokeWidth: 0 }}
              activeDot={{ r: 5, strokeWidth: 0 }}
              connectNulls={false}
              hide={!bottomVisibility.currentRatio}
              isAnimationActive={false}
            />
            <Line
              yAxisId="pct"
              type="monotone"
              dataKey="margin"
              stroke="#f59e0b"
              strokeWidth={2}
              dot={{ fill: "#f59e0b", r: 3, strokeWidth: 0 }}
              activeDot={{ r: 5, strokeWidth: 0 }}
              connectNulls={false}
              hide={!bottomVisibility.margin}
              isAnimationActive={false}
            />
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
          Údaje nedostupné
        </div>
      )}
    </div>
  );
}

// ── Combined component (backwards compatible) ────────────────────────────────

export function FinancialIndicatorsCharts({
  data,
}: {
  data: FinancialIndicatorRow[];
}) {
  return (
    <div className="flex flex-col gap-4">
      <TopFinancialChart data={data} />
      <BottomFinancialChart data={data} />
    </div>
  );
}
