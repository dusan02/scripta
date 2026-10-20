"use client";

import { useState } from "react";
import { useT } from "@/components/LanguageProvider";

function parseActivityItems(raw: string): string[] {
  return raw
    .split(/;|\r?\n/)
    .map((s) =>
      s
        .replace(/^[\s\-–•,;]+/, "")
        .replace(/[\s,;]+$/, "")
        .replace(/\/([^/]{2,40})\//g, "($1)")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter((s) => s.length > 2);
}

export function BusinessActivitySection({ activity }: { activity: string }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);

  if (!activity || activity.trim().length === 0) return null;

  const items = parseActivityItems(activity);
  const INITIAL_LIMIT = 6;

  if (items.length <= 1) {
    const cleaned = items[0] || activity.trim();
    const isLong = cleaned.length > 300;
    const displayText = isLong && !expanded ? cleaned.slice(0, 300) + "…" : cleaned;
    return (
      <div className="mb-6 sm:mb-8 print-section">
        <h2 className="text-lg sm:text-xl font-bold mb-2" style={{ color: "var(--text)" }}>
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
              onClick={() => setExpanded((v) => !v)}
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

  const visibleItems = expanded ? items : items.slice(0, INITIAL_LIMIT);
  const hiddenCount = items.length - INITIAL_LIMIT;

  return (
    <div className="mb-6 sm:mb-8 print-section">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <h2 className="text-lg sm:text-xl font-bold" style={{ color: "var(--text)" }}>
          {t("firma.predmetCinnosti")}
        </h2>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {items.length} činností
        </span>
      </div>
      <div
        className="rounded-lg p-3 sm:p-4"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
      >
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
          {visibleItems.map((item, idx) => (
            <li
              key={idx}
              className="flex items-start gap-2 text-xs sm:text-sm leading-snug"
              style={{ color: "var(--text-secondary)" }}
            >
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: "var(--accent)" }} />
              <span>{item.charAt(0).toUpperCase() + item.slice(1)}</span>
            </li>
          ))}
        </ul>
        {hiddenCount > 0 && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="mt-3 text-xs font-semibold no-print cursor-pointer"
            style={{ color: "var(--accent)" }}
          >
            {expanded ? t("firma.zbalit") : `Zobraziť všetky predmety činnosti (${items.length}) →`}
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
