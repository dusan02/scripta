"use client";

import { SOURCE_CATEGORIES, SOURCE_MAP, SOURCE_DOT_COLOR } from "@/lib/sources";

interface SourceBadgesProps {
  sources: { sourceType: string; status: string }[];
}

export default function SourceBadges({ sources }: SourceBadgesProps) {
  return (
    <>
      {SOURCE_CATEGORIES.map((cat) => {
        const catSources = sources.filter(s => {
          const meta = SOURCE_MAP[s.sourceType];
          return meta && meta.category === cat.id;
        });
        if (catSources.length === 0) return null;
        return (
          <div key={cat.id} className="flex items-center gap-1">
            {catSources.map((s) => (
              <span
                key={s.sourceType}
                title={`${s.sourceType}: ${s.status}`}
                className="inline-flex items-center justify-center rounded text-[10px] font-bold px-2 py-1"
                style={{
                  background: "var(--bg-muted)",
                  color: SOURCE_DOT_COLOR[s.status] ?? "var(--text-muted)",
                  border: "1px solid var(--border)",
                }}
              >
                {SOURCE_MAP[s.sourceType]?.label ?? s.sourceType}
              </span>
            ))}
          </div>
        );
      })}
    </>
  );
}
