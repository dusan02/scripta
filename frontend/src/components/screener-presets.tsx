"use client";

import { useRouter, useSearchParams } from "next/navigation";

type Preset = {
  label: string;
  url: string;
  icon: string;
  match: (sp: URLSearchParams) => boolean;
};

const PRESETS: Preset[] = [
  {
    label: "Top firmy podľa tržieb",
    url: "/screener",
    icon: "🏆",
    match: (sp) => sp.toString() === "" || (sp.get("sort") === "latestRevenue" && sp.get("dir") !== "asc" && !sp.get("naceSection") && !sp.get("profitMax")),
  },
  {
    label: "Najziskovejšie",
    url: "/screener?sort=latestProfit&dir=desc",
    icon: "💰",
    match: (sp) => sp.get("sort") === "latestProfit" && sp.get("dir") === "desc" && !sp.get("profitMax"),
  },
  {
    label: "Najväčšie aktíva",
    url: "/screener?sort=latestAssets&dir=desc",
    icon: "🏦",
    match: (sp) => sp.get("sort") === "latestAssets" && sp.get("dir") === "desc",
  },
  {
    label: "Firmy v strate",
    url: "/screener?profitMax=0&sort=latestProfit&dir=asc",
    icon: "�",
    match: (sp) => sp.get("profitMax") === "0",
  },
  {
    label: "Najstaršie firmy",
    url: "/screener?sort=establishedAt&dir=asc",
    icon: "�️",
    match: (sp) => sp.get("sort") === "establishedAt" && sp.get("dir") === "asc",
  },
  {
    label: "Priemyselná výroba",
    url: "/screener?naceSection=C",
    icon: "🏭",
    match: (sp) => sp.get("naceSection") === "C",
  },
  {
    label: "IT a komunikácie",
    url: "/screener?naceSection=J",
    icon: "💻",
    match: (sp) => sp.get("naceSection") === "J",
  },
  {
    label: "Stavebníctvo",
    url: "/screener?naceSection=F",
    icon: "🏗️",
    match: (sp) => sp.get("naceSection") === "F",
  },
  {
    label: "Obchod",
    url: "/screener?naceSection=G",
    icon: "🛒",
    match: (sp) => sp.get("naceSection") === "G",
  },
  {
    label: "Doprava a skladovanie",
    url: "/screener?naceSection=H",
    icon: "🚚",
    match: (sp) => sp.get("naceSection") === "H",
  },
];

export function ScreenerPresets() {
  const router = useRouter();
  const searchParams = useSearchParams();

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
