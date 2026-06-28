"use client";

import { useState, useRef, useEffect } from "react";
import { useLang } from "@/components/LanguageProvider";
import { LANGUAGES } from "@/lib/i18n";

export default function LanguageSwitcher() {
  const { lang, setLang } = useLang();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const current = LANGUAGES.find((l) => l.code === lang)!;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-150"
        style={{
          background: "var(--bg-muted)",
          border: "1px solid var(--border)",
          color: "var(--text-secondary)",
          fontSize: "16px",
          cursor: "pointer",
        }}
        title={current.label}
        aria-label="Language"
      >
        {current.flag}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 rounded-lg overflow-hidden fade-in"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            boxShadow: "var(--shadow-md)",
            zIndex: 100,
            minWidth: "140px",
          }}
        >
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              onClick={() => {
                setLang(l.code);
                setOpen(false);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors text-left"
              style={{
                background: l.code === lang ? "var(--accent-light)" : "transparent",
                color: l.code === lang ? "var(--accent)" : "var(--text-secondary)",
                cursor: "pointer",
              }}
              onMouseEnter={(e) => {
                if (l.code !== lang) (e.currentTarget as HTMLElement).style.background = "var(--bg-muted)";
              }}
              onMouseLeave={(e) => {
                if (l.code !== lang) (e.currentTarget as HTMLElement).style.background = "transparent";
              }}
            >
              <span style={{ fontSize: "16px" }}>{l.flag}</span>
              <span className="font-medium">{l.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
