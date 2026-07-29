import Link from "next/link";

export function ReportCTA({ ico, name }: { ico: string; name: string }) {
  return (
    <div className="rounded-2xl p-5 sm:p-8 text-center mb-6 sm:mb-8" style={{ background: "linear-gradient(135deg, rgba(16,185,129,0.08), rgba(59,130,246,0.08))", border: "1px solid var(--accent-border)" }}>
      <h2 className="text-lg sm:text-xl font-bold mb-2" style={{ color: "var(--text)" }}>
        Odhaľte skutočné riziká firmy {name}
      </h2>
      <p className="text-sm mb-5" style={{ color: "var(--text-secondary)" }}>
        Základné trendy ukazujú len začiatok. Plnohodnotný report odhalí exekúcie, insolvencie, konkurzy,
        zmeny v štatutároch, Altman Z-skóre a rizikové semafóry z 26 registrov — všetko v jednom PDF za 10 minút.
      </p>
      <Link
        href={`/dashboard?ico=${ico}`}
        className="inline-block px-6 sm:px-8 py-3 rounded-xl font-bold text-sm transition-all hover:scale-105"
        style={{ background: "var(--accent)", color: "#fff", boxShadow: "0 4px 14px rgba(16,185,129,0.3)" }}
      >
        Vygenerovať report →
      </Link>
    </div>
  );
}
