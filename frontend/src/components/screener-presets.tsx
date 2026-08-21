"use client";

import { useRouter } from "next/navigation";

type Preset = {
  label: string;
  url: string;
  icon: string;
};

const PRESETS: Preset[] = [
  { label: "Top firmy podľa tržieb", url: "/screener", icon: "🏆" },
  { label: "Najstaršie firmy", url: "/screener?sort=establishedAt&dir=asc", icon: "🏛️" },
  { label: "Firmy v strate", url: "/screener?profitMax=0&sort=latestProfit&dir=asc", icon: "📉" },
  { label: "Najziskovejšie", url: "/screener?sort=latestProfit&dir=desc", icon: "💰" },
  { label: "Najväčšie aktíva", url: "/screener?sort=latestAssets&dir=desc", icon: "🏦" },
  { label: "Priemyselná výroba", url: "/screener?naceSection=C", icon: "🏭" },
  { label: "IT a komunikácie", url: "/screener?naceSection=J", icon: "💻" },
  { label: "Stavebníctvo", url: "/screener?naceSection=F", icon: "🏗️" },
];

export function ScreenerPresets() {
  const router = useRouter();

  return (
    <div className="flex flex-wrap gap-2">
      {PRESETS.map((preset) => (
        <button
          key={preset.label}
          onClick={() => router.push(preset.url)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-[var(--surface-hover)]"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            color: "var(--text-secondary)",
          }}
        >
          <span style={{ fontSize: "14px" }}>{preset.icon}</span>
          <span>{preset.label}</span>
        </button>
      ))}
    </div>
  );
}
