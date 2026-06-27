"use client";

import { useState, useEffect, Suspense } from "react";
import ReportForm from "@/components/ReportForm";
import RegistryGrid from "@/components/RegistryGrid";
import { DEFAULT_SELECTED_SOURCES, ENABLED_SOURCES } from "@/lib/sources";

export default function SearchSection() {
  const [selected, setSelected] = useState<string[]>(DEFAULT_SELECTED_SOURCES);

  // Načítať používateľove predvolené registre po prihlásení
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => {
        if (!r.ok) return null;
        return r.json();
      })
      .then((data) => {
        if (data?.defaultSources && Array.isArray(data.defaultSources) && data.defaultSources.length > 0) {
          // Iba existujúce a enabled zdroje
          const validIds = data.defaultSources.filter((id: string) =>
            ENABLED_SOURCES.some(s => s.id === id)
          );
          if (validIds.length > 0) {
            setSelected(validIds);
          }
        }
      })
      .catch(() => {});
  }, []);

  const toggleSource = (id: string) =>
    setSelected((p) => (p.includes(id) ? p.filter((s) => s !== id) : [...p, id]));

  return (
    <>
      {/* ── TOP SECTION: Search bar only (fixed height) ── */}
      <section
        className="flex flex-col items-center justify-center px-2 pt-6 pb-5"
        style={{
          borderBottom: "1px solid var(--border)",
          minHeight: "180px",
        }}
      >
        <div className="text-center mb-4 fade-in">
          <h1
            className="text-xl sm:text-2xl font-bold tracking-tight mb-1"
            style={{
              color: "var(--text)",
              letterSpacing: "-0.02em",
              lineHeight: 1.1,
            }}
          >
            Overenie subjektu
          </h1>
          <p className="text-xs sm:text-sm px-2" style={{ color: "var(--text-muted)" }}>
            Zadajte IČO alebo meno osoby a vyberte registre, ktoré chcete preveriť
          </p>
        </div>

        <div className="w-full" style={{ maxWidth: 480 }}>
          <Suspense fallback={null}>
            <ReportForm
              selected={selected}
              onSelectedChange={setSelected}
            />
          </Suspense>
        </div>
      </section>

      {/* ── BOTTOM SECTION: Registry grid (full width) ── */}
      <section className="px-2 pt-5 pb-8">
        <RegistryGrid
          mode="selection"
          selected={selected}
          onToggle={toggleSource}
          onSelectAll={() => setSelected(ENABLED_SOURCES.map(s => s.id))}
          onSelectNone={() => setSelected([])}
        />
      </section>
    </>
  );
}
