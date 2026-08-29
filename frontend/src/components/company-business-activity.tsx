"use client";

import { useState } from "react";
import { useT } from "@/components/LanguageProvider";

export function BusinessActivitySection({ activity }: { activity: string }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);

  if (!activity || activity.trim().length === 0) return null;

  const isLong = activity.length > 300;
  const displayText = isLong && !expanded
    ? activity.slice(0, 300) + "…"
    : activity;

  return (
    <div className="mb-6 sm:mb-8 print-section">
      <h2 className="text-sm sm:text-base font-bold mb-2" style={{ color: "var(--text)" }}>
        {t("firma.predmetCinnosti")}
      </h2>
      <div
        className="rounded-lg p-3 sm:p-4"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
      >
        <p className="text-xs sm:text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          {displayText}
        </p>
        {isLong && (
          <button
            onClick={() => setExpanded(v => !v)}
            className="mt-2 text-xs font-medium no-print"
            style={{ color: "var(--accent)" }}
          >
            {expanded ? t("firma.zbalit") : t("firma.rozbalit")}
          </button>
        )}
      </div>
    </div>
  );
}

export function SigningAuthoritySection({ authority, noHeading }: { authority: string; noHeading?: boolean }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);

  if (!authority || authority.trim().length === 0) return null;

  const isLong = authority.length > 200;
  const displayText = isLong && !expanded
    ? authority.slice(0, 200) + "…"
    : authority;

  return (
    <div className={noHeading ? "" : "mb-6 sm:mb-8 no-print"}>
      {!noHeading && (
        <h3 className="text-sm font-bold mb-2" style={{ color: "var(--text)" }}>
          {t("firma.konanieMenom")}
        </h3>
      )}
      <div
        className="rounded-lg p-3 sm:p-4"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
      >
        <p className="text-xs sm:text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          {displayText}
        </p>
        {isLong && (
          <button
            onClick={() => setExpanded(v => !v)}
            className="mt-2 text-xs font-medium"
            style={{ color: "var(--accent)" }}
          >
            {expanded ? t("firma.zbalit") : t("firma.rozbalit")}
          </button>
        )}
      </div>
    </div>
  );
}
