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

type SeriesKey = "roe" | "roa" | "margin" | "debt" | "shortTermDebt" | "longTermDebt";

type SeriesConfig = {
  key: SeriesKey;
  label: string;
  color: string;
};

type Visibility = Record<SeriesKey, boolean>;

// ── Dynamic Y-axis domain ────────────────────────────────────────────────────

function computePctDomain(
  data: FinancialIndicatorRow[],
  keys: SeriesKey[],
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
  series: SeriesConfig[];
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
              {v == null ? "—" : `${v.toFixed(1)}%`}
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
      className="legend-btn flex items-center gap-1.5 text-xs cursor-pointer rounded px-2 py-1.5 transition-opacity"
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

// ── Generic single-axis percentage chart ─────────────────────────────────────

function PctChart({
  data,
  series,
  visibility,
  toggle,
  height = 220,
}: {
  data: FinancialIndicatorRow[];
  series: SeriesConfig[];
  visibility: Visibility;
  toggle: (key: SeriesKey) => void;
  height?: number;
}) {
  const visibleKeys = useMemo(
    () => series.filter((s) => visibility[s.key]).map((s) => s.key),
    [series, visibility],
  );

  const domain = useMemo(
    () => computePctDomain(data, visibleKeys),
    [data, visibleKeys],
  );

  const hasData = visibleKeys.length > 0;

  // Scale ×100 for chart rendering (FinancialIndicatorRow stores fractions)
  const chartData = useMemo(
    () =>
      data.map((row) => {
        const scaled: Record<string, number | null> = { year: row.year };
        for (const s of series) {
          const v = row[s.key];
          scaled[s.key] = v != null ? v * 100 : null;
        }
        return scaled;
      }),
    [data, series],
  );

  return (
    <div>
      <div
        className="flex flex-wrap gap-x-3 gap-y-1.5 mb-2"
        role="group"
        aria-label="Viditeľnosť ukazovateľov"
      >
        {series.map((s) => (
          <LegendButton
            key={s.key}
            label={s.label}
            color={s.color}
            visible={visibility[s.key]}
            onClick={() => toggle(s.key)}
            axisColor={axisColor}
          />
        ))}
      </div>

      {hasData ? (
        <ResponsiveContainer width="100%" height={height} minHeight={height}>
          <LineChart
            data={chartData}
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
              domain={domain}
              tickFormatter={pctTickFormatter}
              tick={{ fill: axisColor, fontSize: 11 }}
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
            height,
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

// ── Chart 1: Rentabilita (ROE, ROA, Zisková marža) ───────────────────────────

export function RentabilityChart({
  data,
}: {
  data: FinancialIndicatorRow[];
}) {
  const t = useT();

  const series: SeriesConfig[] = useMemo(
    () => [
      { key: "roe", label: "ROE", color: "#10b981" },
      { key: "roa", label: "ROA", color: "#3b82f6" },
      { key: "margin", label: t("firma.ziskovaMarza"), color: "#f59e0b" },
    ],
    [t],
  );

  const [visibility, setVisibility] = useState<Visibility>({
    roe: true,
    roa: true,
    margin: true,
    debt: false,
    shortTermDebt: false,
    longTermDebt: false,
  });

  const toggle = (key: SeriesKey) =>
    setVisibility((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <PctChart
      data={data}
      series={series}
      visibility={visibility}
      toggle={toggle}
    />
  );
}

// ── Chart 2: Finančná stabilita (Zadlženosť, ST%, LT%) ───────────────────────

export function StabilityChart({
  data,
}: {
  data: FinancialIndicatorRow[];
}) {
  const t = useT();

  const series: SeriesConfig[] = useMemo(
    () => [
      { key: "debt", label: t("firma.zadlzenost"), color: "#ef4444" },
      { key: "shortTermDebt", label: t("firma.podielKratkodobych"), color: "#f97316" },
      { key: "longTermDebt", label: t("firma.podielDlhodobych"), color: "#a855f7" },
    ],
    [t],
  );

  const [visibility, setVisibility] = useState<Visibility>({
    roe: false,
    roa: false,
    margin: false,
    debt: true,
    shortTermDebt: true,
    longTermDebt: true,
  });

  const toggle = (key: SeriesKey) =>
    setVisibility((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <PctChart
      data={data}
      series={series}
      visibility={visibility}
      toggle={toggle}
    />
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
      <RentabilityChart data={data} />
      <StabilityChart data={data} />
    </div>
  );
}
