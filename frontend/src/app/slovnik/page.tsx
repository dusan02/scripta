import type { Metadata } from "next";
import Link from "next/link";
import { getGlossaryTermsByCategory, glossaryTerms } from "@/lib/glossary";

export const metadata: Metadata = {
  title: "Slovník pojmov | Verifa.sk",
  description:
    "Slovník kľúčových pojmov z oblasti due diligence, finančnej analýzy a štátnych registrov — Altman Z-Score, Piotroski F-Score, ORSR, RPVS, Register úpadcov a ďalšie.",
  alternates: {
    canonical: "https://verifa.sk/slovnik",
  },
};

export default function GlossaryPage() {
  const grouped = getGlossaryTermsByCategory();
  const categories = Object.keys(grouped).sort();

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "120px 24px 80px" }}>
        <h1 style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 16 }}>
          Slovník pojmov
        </h1>
        <p style={{ fontSize: 17, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 48, maxWidth: 700 }}>
          Kľúčové pojmy z oblasti due diligence, finančnej analýzy a štátnych registrov. Vysvetlíme vám, čo znamenajú a prečo sú dôležité pri preverovaní firiem.
        </p>

        {categories.map((category) => (
          <div key={category} style={{ marginBottom: 48 }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20, color: "var(--accent)" }}>
              {category}
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {grouped[category].map((term) => (
                <Link
                  key={term.slug}
                  href={`/slovnik/${term.slug}`}
                  style={{
                    display: "block",
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                    padding: "20px 24px",
                    textDecoration: "none",
                  }}
                >
                  <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6, color: "var(--text)" }}>
                    {term.title}
                  </h3>
                  <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                    {term.shortDescription}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        ))}

        <div style={{ marginTop: 60, padding: "32px 24px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 16, textAlign: "center" }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>Chcete tieto pojmy vidieť v praxi?</h3>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", marginBottom: 24, maxWidth: 500, margin: "0 auto 24px" }}>
            Vygenerujte komplexný due diligence report z 20+ registrov s Verifa Score za 5 minút.
          </p>
          <Link
            href="/register"
            style={{
              display: "inline-block",
              background: "var(--accent)",
              color: "var(--accent-button-text)",
              padding: "14px 32px",
              borderRadius: 12,
              textDecoration: "none",
              fontWeight: 700,
              fontSize: 15,
            }}
          >
            Začať overovať →
          </Link>
        </div>
      </div>
    </div>
  );
}
