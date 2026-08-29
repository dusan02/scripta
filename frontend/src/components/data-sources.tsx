"use client";

import { useT } from "@/components/LanguageProvider";

type SourceInfo = {
  name: string;
  syncedAt: Date | null;
  dataRange?: string | null;
};

export function DataSourcesSection({ sources, noHeading }: { sources: SourceInfo[]; noHeading?: boolean }) {
  const t = useT();
  if (sources.length === 0) return null;

  return (
    <div className={noHeading ? "" : "mb-6 sm:mb-8 no-print"}>
      {!noHeading && (
        <h2 className="text-sm sm:text-base font-bold mb-3" style={{ color: "var(--text)" }}>
          {t("firma.zdrojeUdajov") || "Zdroje údajov"}
        </h2>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {sources.map((src) => (
          <div
            key={src.name}
            className="rounded-lg p-3"
            style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
          >
            <div className="text-sm font-medium" style={{ color: "var(--text)" }}>{src.name}</div>
            {src.dataRange && (
              <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                {t("firma.obdobie") || "Obdobie"}: {src.dataRange}
              </div>
            )}
            {src.syncedAt && (
              <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                {t("firma.aktualizovane") || "Aktualizované"}:{" "}
                {new Date(src.syncedAt).toLocaleDateString("sk-SK")}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
