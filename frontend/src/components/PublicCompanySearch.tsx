"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface SearchResultItem {
  ico: string;
  name: string;
  city: string | null;
  latestRevenue: number | null;
  latestYear: number | null;
  href: string;
}

function fmtRevenueCompact(val: number | null): string | null {
  if (val == null || !Number.isFinite(val) || val <= 0) return null;
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)} M €`;
  if (val >= 1_000) return `${Math.round(val / 1_000)} tis. €`;
  return `${Math.round(val)} €`;
}

export function PublicCompanySearch({
  variant = "hero",
  placeholder = "Zadajte názov firmy alebo IČO (napr. ESET, 31333532)…",
}: {
  variant?: "hero" | "compact";
  placeholder?: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/companies/search?q=${encodeURIComponent(q)}`, {
          signal: ctrl.signal,
        });
        if (!res.ok) {
          setLoading(false);
          return;
        }
        const data = await res.json();
        setResults(Array.isArray(data?.results) ? data.results : []);
        setActiveIndex(-1);
        setOpen(true);
      } catch {
        // aborted
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [query]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setOpen(false);
    if (activeIndex >= 0 && results[activeIndex]) {
      router.push(results[activeIndex].href);
      return;
    }
    const cleanDigits = q.replace(/\s+/g, "");
    if (/^\d{8}$/.test(cleanDigits)) {
      router.push(`/firma/${cleanDigits}`);
      return;
    }
    if (results.length === 1) {
      router.push(results[0].href);
      return;
    }
    router.push(`/screener?q=${encodeURIComponent(q)}`);
  };

  const isHero = variant === "hero";

  return (
    <div ref={wrapRef} className="relative w-full" style={{ maxWidth: isHero ? 680 : 340 }}>
      <form onSubmit={handleSubmit} className="relative flex items-center">
        <svg
          width={isHero ? 18 : 14}
          height={isHero ? 18 : 14}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            position: "absolute",
            left: isHero ? 16 : 11,
            color: "var(--text-muted)",
            pointerEvents: "none",
          }}
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          type="search"
          value={query}
          onFocus={() => {
            if (results.length > 0 || query.trim().length >= 3) setOpen(true);
          }}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActiveIndex((prev) => Math.min(results.length - 1, prev + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIndex((prev) => Math.max(-1, prev - 1));
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder={placeholder}
          aria-label="Vyhľadať firmu podľa názvu alebo IČO"
          style={{
            width: "100%",
            height: isHero ? 52 : 36,
            paddingLeft: isHero ? 44 : 32,
            paddingRight: isHero ? 116 : 28,
            borderRadius: isHero ? 14 : 9,
            border: "1px solid var(--border)",
            background: "var(--surface)",
            color: "var(--text)",
            fontSize: isHero ? 15 : 13,
            outline: "none",
          }}
        />
        {isHero && (
          <button
            type="submit"
            style={{
              position: "absolute",
              right: 6,
              height: 40,
              padding: "0 18px",
              borderRadius: 10,
              background: "var(--accent)",
              color: "var(--accent-button-text)",
              fontWeight: 700,
              fontSize: 14,
              border: "none",
              cursor: "pointer",
            }}
          >
            Hľadať
          </button>
        )}
      </form>

      {open && query.trim().length >= 3 && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            right: 0,
            zIndex: 60,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            boxShadow: "0 12px 32px rgba(0,0,0,0.16)",
            overflow: "hidden",
          }}
        >
          {loading && results.length === 0 ? (
            <div style={{ padding: "12px 16px", fontSize: 13, color: "var(--text-muted)" }}>
              Hľadám v ORSR a RÚZ…
            </div>
          ) : results.length === 0 ? (
            <div style={{ padding: "12px 16px", fontSize: 13, color: "var(--text-muted)" }}>
              Žiadna firma sa nenašla —{" "}
              <Link
                href={`/screener?q=${encodeURIComponent(query.trim())}`}
                onClick={() => setOpen(false)}
                style={{ color: "var(--accent)", fontWeight: 600 }}
              >
                otvoriť rozšírené vyhľadávanie →
              </Link>
            </div>
          ) : (
            <>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: 340, overflowY: "auto" }}>
                {results.map((item, idx) => {
                  const rev = fmtRevenueCompact(item.latestRevenue);
                  const active = idx === activeIndex;
                  return (
                    <li key={item.ico}>
                      <Link
                        href={item.href}
                        onClick={() => setOpen(false)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 12,
                          padding: "10px 14px",
                          textDecoration: "none",
                          background: active ? "var(--surface-hover)" : "transparent",
                          borderBottom: "1px solid var(--border)",
                        }}
                      >
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div
                            style={{
                              fontSize: 13,
                              fontWeight: 600,
                              color: "var(--text)",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {item.name}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                            IČO {item.ico}
                            {item.city ? ` · ${item.city}` : ""}
                          </div>
                        </div>
                        {rev && (
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              color: "var(--accent)",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {rev}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <Link
                href={`/screener?q=${encodeURIComponent(query.trim())}`}
                onClick={() => setOpen(false)}
                style={{
                  display: "block",
                  padding: "9px 14px",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--accent)",
                  textAlign: "center",
                  textDecoration: "none",
                  background: "var(--bg-muted)",
                }}
              >
                Zobraziť všetky výsledky pre „{query.trim()}“ v screeneri →
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}
