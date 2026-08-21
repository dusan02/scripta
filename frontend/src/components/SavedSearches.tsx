"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SearchIcon, TrashIcon, SpinnerIcon } from "@/components/icons";

interface SavedSearch {
  id: string;
  name: string;
  filters: Record<string, string>;
  createdAt: string;
}

export default function SavedSearches() {
  const router = useRouter();
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/saved-searches")
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.searches) setSearches(data.searches); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      const r = await fetch(`/api/saved-searches?id=${id}`, { method: "DELETE" });
      if (r.ok) setSearches(prev => prev.filter(s => s.id !== id));
    } finally {
      setDeleting(null);
    }
  };

  const formatFilters = (filters: Record<string, string>) => {
    const parts: string[] = [];
    if (filters.q) parts.push(`"${filters.q}"`);
    if (filters.kraj) parts.push(filters.kraj);
    if (filters.okres) parts.push(filters.okres);
    if (filters.city) parts.push(filters.city);
    if (filters.legalForm) parts.push(filters.legalForm);
    if (filters.naceSection) parts.push(`NACE ${filters.naceSection}`);
    if (filters.revenueMin || filters.revenueMax) parts.push("Tržby");
    if (filters.profitMin || filters.profitMax) parts.push("Zisk");
    if (filters.sort) parts.push(`${filters.sort} ${filters.dir || "desc"}`);
    return parts.length > 0 ? parts.join(", ") : "Všetky firmy";
  };

  if (loading) return null;

  return (
    <div
      className="mt-6 p-4 rounded-xl"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold" style={{ color: "var(--text)" }}>
          Uložené vyhľadávania
        </h3>
        <Link
          href="/screener"
          className="text-xs font-medium hover:underline"
          style={{ color: "var(--accent)" }}
        >
          Nové vyhľadávanie →
        </Link>
      </div>

      {searches.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Zatiaľ nemáte uložené žiadne vyhľadávania. Vytvorte ich na stránke{" "}
          <Link href="/screener" className="underline" style={{ color: "var(--accent)" }}>
            Screener
          </Link>
          .
        </p>
      ) : (
        <div className="space-y-2">
          {searches.map((s) => {
            const qs = new URLSearchParams(s.filters).toString();
            return (
              <div
                key={s.id}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg transition-colors hover:bg-[var(--surface-hover)]"
                style={{ border: "1px solid var(--border)" }}
              >
                <button
                  onClick={() => router.push(`/screener?${qs}`)}
                  className="flex-1 text-left min-w-0"
                >
                  <div className="text-xs font-medium truncate" style={{ color: "var(--text)" }}>
                    {s.name}
                  </div>
                  <div className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>
                    {formatFilters(s.filters)}
                  </div>
                </button>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => router.push(`/screener?${qs}`)}
                    className="p-1.5 rounded transition-colors hover:bg-[var(--bg-muted)]"
                    style={{ color: "var(--accent)" }}
                    title="Spustiť vyhľadávanie"
                  >
                    <SearchIcon size={14} />
                  </button>
                  <button
                    onClick={() => handleDelete(s.id)}
                    disabled={deleting === s.id}
                    className="p-1.5 rounded transition-colors hover:bg-[var(--bg-muted)]"
                    style={{ color: "var(--danger)" }}
                    title="Odstrániť"
                  >
                    {deleting === s.id ? <SpinnerIcon size={14} /> : <TrashIcon size={14} />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
