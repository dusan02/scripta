"use client";

import { useT } from "@/components/LanguageProvider";

export default function SkipToContent() {
  const t = useT();
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:rounded-lg"
      style={{ background: "var(--surface)", border: "1px solid var(--accent)", color: "var(--text)" }}
    >
      {t("a11y.skipToContent")}
    </a>
  );
}
