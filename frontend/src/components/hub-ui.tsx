"use client";

import Link from "next/link";
import { fmtEurK } from "@/lib/format";
import type { HubResult } from "@/lib/hub";

export function HubTable({ companies }: { companies: HubResult["companies"] }) {
  return (
    <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--border)" }}>
      <table className="w-full text-sm">
        <thead>
          <tr style={{ background: "var(--surface)" }}>
            <th className="text-left px-4 py-3 font-semibold" style={{ color: "var(--text)" }}>Firma</th>
            <th className="text-left px-4 py-3 font-semibold" style={{ color: "var(--text)" }}>Odvetvie</th>
            <th className="text-left px-4 py-3 font-semibold" style={{ color: "var(--text)" }}>Mesto</th>
            <th className="text-right px-4 py-3 font-semibold" style={{ color: "var(--text)" }}>Tržby</th>
            <th className="text-right px-4 py-3 font-semibold" style={{ color: "var(--text)" }}>Zisk</th>
          </tr>
        </thead>
        <tbody>
          {companies.map((f) => (
            <tr key={f.ico} className="border-t hover:bg-[var(--surface)]" style={{ borderColor: "var(--border)" }}>
              <td className="px-4 py-3">
                <Link
                  href={`/firma/${f.ico}-${slugifyInline(f.name)}`}
                  className="font-medium hover:underline"
                  style={{ color: "var(--accent)" }}
                >
                  {f.name || f.ico}
                </Link>
              </td>
              <td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>{f.naceText || "—"}</td>
              <td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>{f.city || "—"}</td>
              <td className="px-4 py-3 text-right" style={{ color: "var(--text)" }}>
                {f.latestRevenue ? (
                  <span>
                    {fmtEurK(f.latestRevenue)}
                    {f.latestYear && (
                      <span className="text-xs ml-1" style={{ color: "var(--text-muted)" }}>· {f.latestYear}</span>
                    )}
                  </span>
                ) : "—"}
              </td>
              <td className="px-4 py-3 text-right" style={{ color: "var(--text)" }}>
                {f.latestProfit ? (
                  <span>
                    {fmtEurK(f.latestProfit)}
                    {f.latestYear && (
                      <span className="text-xs ml-1" style={{ color: "var(--text-muted)" }}>· {f.latestYear}</span>
                    )}
                  </span>
                ) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SubHubLinks({ subHubs, title }: { subHubs: HubResult["subHubs"]; title: string }) {
  if (subHubs.length === 0) return null;
  return (
    <div className="mt-6 mb-6">
      <h2 className="text-lg font-bold mb-3" style={{ color: "var(--text)" }}>{title}</h2>
      <div className="flex flex-wrap gap-2">
        {subHubs.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors hover:opacity-80"
            style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--accent)" }}
          >
            {s.label} <span style={{ color: "var(--text-muted)" }}>({s.count.toLocaleString("sk-SK")})</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function HubPagination({
  page,
  totalPages,
  basePath,
}: {
  page: number;
  totalPages: number;
  basePath: string;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-2 mt-6 mb-6">
      {page > 1 && (
        <Link
          href={`${basePath}?page=${page - 1}`}
          className="px-3 py-2 rounded-lg text-sm font-medium"
          style={{ border: "1px solid var(--border)", color: "var(--text)" }}
        >
          ← Predošlá
        </Link>
      )}
      <span style={{ color: "var(--text-secondary)" }}>
        Strana {page} z {totalPages}
      </span>
      {page < totalPages && (
        <Link
          href={`${basePath}?page=${page + 1}`}
          className="px-3 py-2 rounded-lg text-sm font-medium"
          style={{ border: "1px solid var(--border)", color: "var(--text)" }}
        >
          Ďalšia →
        </Link>
      )}
    </div>
  );
}

export function HubBreadcrumbs({ items }: { items: Array<{ label: string; href?: string }> }) {
  return (
    <div className="flex items-center gap-2 text-xs sm:text-sm mb-4" style={{ color: "var(--text-muted)" }}>
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-2">
          {item.href ? (
            <Link href={item.href} className="hover:underline">{item.label}</Link>
          ) : (
            <span style={{ color: "var(--text)" }}>{item.label}</span>
          )}
          {i < items.length - 1 && <span>/</span>}
        </span>
      ))}
    </div>
  );
}

// Inline slugify to avoid importing server-only lib in client component
function slugifyInline(name: string | null | undefined): string {
  if (!name) return "firma";
  return name
    .toLowerCase()
    .replace(/[áä]/g, "a").replace(/[éě]/g, "e").replace(/[í]/g, "i")
    .replace(/[óô]/g, "o").replace(/[úů]/g, "u").replace(/[ý]/g, "y")
    .replace(/[ž]/g, "z").replace(/[š]/g, "s").replace(/[č]/g, "c")
    .replace(/[ř]/g, "r").replace(/[ď]/g, "d").replace(/[ť]/g, "t")
    .replace(/[ň]/g, "n").replace(/[ľĺ]/g, "l")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 60) || "firma";
}
