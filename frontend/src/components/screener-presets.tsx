"use client";

import { useRouter } from "next/navigation";

type SearchParamsMap = Record<string, string | string[] | undefined>;

function spGet(sp: SearchParamsMap | undefined, key: string): string | null {
  if (!sp) return null;
  const v = sp[key];
  if (!v) return null;
  return typeof v === "string" ? v : v[0] ?? null;
}

function hasAnyFilter(sp: SearchParamsMap | undefined): boolean {
  if (!sp) return false;
  return Object.entries(sp).some(([, v]) =>
    typeof v === "string" ? v.length > 0 : Array.isArray(v) && v.length > 0
  );
}

type Preset = {
  label: string;
  url: string;
  icon: string;
  match: (sp: SearchParamsMap | undefined) => boolean;
};

const PRESETS: Preset[] = [
  {
    label: "Top firmy podľa tržieb",
    url: "/screener",
    icon: "🏆",
    match: (sp) =>
      !hasAnyFilter(sp) ||
      (spGet(sp, "sort") === "latestRevenue" &&
        spGet(sp, "dir") !== "asc" &&
        !spGet(sp, "naceSection") &&
        !spGet(sp, "profitMax")),
  },
  {
    label: "Najziskovejšie",
    url: "/screener?sort=latestProfit&dir=desc",
    icon: "💰",
    match: (sp) =>
      spGet(sp, "sort") === "latestProfit" &&
      spGet(sp, "dir") === "desc" &&
      !spGet(sp, "profitMax"),
  },
  {
    label: "Najväčšie aktíva",
    url: "/screener?sort=latestAssets&dir=desc",
    icon: "🏦",
    match: (sp) => spGet(sp, "sort") === "latestAssets" && spGet(sp, "dir") === "desc",
  },
  {
    label: "Firmy v strate",
    url: "/screener?profitMax=0&sort=latestProfit&dir=asc",
    icon: "📉",
    match: (sp) => spGet(sp, "profitMax") === "0",
  },
  {
    label: "Najstaršie firmy",
    url: "/screener?sort=establishedAt&dir=asc",
    icon: "🏛️",
    match: (sp) => spGet(sp, "sort") === "establishedAt" && spGet(sp, "dir") === "asc",
  },
  {
    label: "Priemyselná výroba",
    url: "/screener?naceSection=C",
    icon: "🏭",
    match: (sp) => spGet(sp, "naceSection") === "C",
  },
  {
    label: "IT a komunikácie",
    url: "/screener?naceSection=J",
    icon: "💻",
    match: (sp) => spGet(sp, "naceSection") === "J",
  },
  {
    label: "Stavebníctvo",
    url: "/screener?naceSection=F",
    icon: "🏗️",
    match: (sp) => spGet(sp, "naceSection") === "F",
  },
  {
    label: "Obchod",
    url: "/screener?naceSection=G",
    icon: "🛒",
    match: (sp) => spGet(sp, "naceSection") === "G",
  },
  {
    label: "Doprava a skladovanie",
    url: "/screener?naceSection=H",
    icon: "🚚",
    match: (sp) => spGet(sp, "naceSection") === "H",
  },
];

export function ScreenerPresets({
  searchParams,
}: {
  searchParams?: SearchParamsMap;
}) {
  const router = useRouter();

  return (
    <div className="flex flex-wrap gap-2">
      {PRESETS.map((preset) => {
        const active = preset.match(searchParams);
        return (
          <button
            key={preset.label}
            onClick={() => router.push(preset.url)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-[var(--surface-hover)]"
            style={{
              background: active ? "var(--accent-light)" : "var(--surface)",
              border: active ? "1px solid var(--accent-border)" : "1px solid var(--border)",
              color: active ? "var(--accent)" : "var(--text-secondary)",
              fontWeight: active ? 700 : 500,
            }}
          >
            <span style={{ fontSize: "14px" }}>{preset.icon}</span>
            <span>{preset.label}</span>
          </button>
        );
      })}
    </div>
  );
}
