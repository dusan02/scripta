export type Trend = { direction: "up" | "down" | "flat"; pct: number } | undefined;

export function calcTrend(
  curr: number | null | undefined,
  prev: number | null | undefined
): Trend {
  if (curr == null || prev == null || prev === 0) return undefined;
  const pct = Math.abs(((curr - prev) / Math.abs(prev)) * 100);
  if (Math.abs(pct) < 1) return { direction: "flat", pct: 0 };
  return { direction: curr > prev ? "up" : "down", pct };
}
