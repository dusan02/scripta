"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useT } from "@/components/LanguageProvider";

export default function StickyCta() {
  const t = useT();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      // Show after scrolling past hero (~600px)
      setVisible(window.scrollY > 600);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40 transition-transform duration-300"
      style={{
        transform: visible ? "translateY(0)" : "translateY(100%)",
        background: "var(--surface)",
        borderTop: "1px solid var(--border)",
        boxShadow: "0 -4px 20px rgba(0,0,0,0.08)",
      }}
    >
      <div className="max-w-[1000px] mx-auto px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold truncate" style={{ color: "var(--text)" }}>
            Verifa
          </span>
          <span className="hidden sm:inline text-sm truncate" style={{ color: "var(--text-muted)" }}>
            · {t("home.heroSubtitle").slice(0, 60)}...
          </span>
        </div>
        <Link
          href="/register"
          className="flex-shrink-0 px-5 py-2.5 rounded-lg no-underline font-bold text-sm transition-all hover:opacity-90"
          style={{ background: "var(--accent)", color: "var(--accent-button-text)" }}
        >
          {t("home.ctaStart")}
        </Link>
      </div>
    </div>
  );
}
