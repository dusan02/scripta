"use client";

import { useT } from "@/components/LanguageProvider";

const ITEMS = [
  // ── Overview (3 cards from old FeaturesSection) ──
  { icon: "R", keys: { title: "home.feature1Title", desc: "home.feature1Desc" } },
  { icon: "F", keys: { title: "home.feature2Title", desc: "home.feature2Desc" } },
  { icon: "V", keys: { title: "home.feature3Title", desc: "home.feature3Desc" } },
  // ── Detailed analyses (6 cards) ──
  { icon: "M", keys: { title: "home.ri1Title", desc: "home.ri1Desc" } },
  { icon: "H", keys: { title: "home.ri2Title", desc: "home.ri2Desc" } },
  { icon: "B", keys: { title: "home.ri3Title", desc: "home.ri3Desc" } },
  { icon: "S", keys: { title: "home.ri4Title", desc: "home.ri4Desc" } },
  { icon: "A", keys: { title: "home.ri5Title", desc: "home.ri5Desc" } },
  { icon: "L", keys: { title: "home.ri6Title", desc: "home.ri6Desc" } },
] as const;

// Inline SVG icons for each card — clean, professional, no emoji
function CardIcon({ type }: { type: string }) {
  const common = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (type) {
    case "R": // Registries — database/layers
      return (
        <svg {...common}>
          <ellipse cx="12" cy="5" rx="9" ry="3" />
          <path d="M3 5v6c0 1.66 4 3 9 3s9-1.34 9-3V5" />
          <path d="M3 11v6c0 1.66 4 3 9 3s9-1.34 9-3v-6" />
        </svg>
      );
    case "F": // Financial analysis — bar chart
      return (
        <svg {...common}>
          <path d="M3 3v18h18" />
          <rect x="7" y="12" width="3" height="6" />
          <rect x="12" y="8" width="3" height="10" />
          <rect x="17" y="5" width="3" height="13" />
        </svg>
      );
    case "V": // Verifa Score — gauge/speedometer
      return (
        <svg {...common}>
          <path d="M12 21a9 9 0 100-18 9 9 0 000 18z" />
          <path d="M12 12l4-3" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      );
    case "M": // Executive summary — document with text lines
      return (
        <svg {...common}>
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <path d="M14 2v6h6M8 13h8M8 17h6M8 9h2" />
        </svg>
      );
    case "H": // Fraud heatmap — grid of squares
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      );
    case "B": // Bankruptcy prediction — trending down gauge
      return (
        <svg {...common}>
          <path d="M3 3v18h18" />
          <path d="M7 14l4-4 4 3 5-6" />
          <path d="M16 7h4v4" />
        </svg>
      );
    case "S": // State liabilities — warning triangle
      return (
        <svg {...common}>
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          <path d="M12 9v4M12 17h.01" />
        </svg>
      );
    case "A": // Audit opinion — shield with checkmark
      return (
        <svg {...common}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
    case "L": // Legal timeline — clock
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    default:
      return null;
  }
}

export default function ReportIncludesSection() {
  const t = useT();

  return (
    <section id="obsah" style={{ padding: "80px 24px", maxWidth: 1200, margin: "0 auto", scrollMarginTop: 80 }} className="section-pad">
      <div style={{ textAlign: "center", marginBottom: 56 }}>
        <h2 style={{ fontSize: "clamp(24px, 3.5vw, 34px)", fontWeight: 800, letterSpacing: "-0.02em", marginBottom: 14 }}>
          {t("home.reportIncludesTitle")}
        </h2>
        <p style={{ fontSize: 15, color: "var(--text-secondary)", maxWidth: 580, margin: "0 auto" }}>
          {t("home.reportIncludesSubtitle")}
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: 20 }} className="report-includes-grid">
        {ITEMS.map((item) => (
          <div
            key={item.keys.title}
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 16,
              padding: 24,
              display: "flex",
              flexDirection: "column",
              gap: 14,
              transition: "box-shadow 0.2s, transform 0.2s",
            }}
            className="report-includes-card"
          >
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  background: "var(--accent-light)",
                  border: "1px solid var(--accent-border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--accent)",
                  flexShrink: 0,
                }}
              >
                <CardIcon type={item.icon} />
              </div>
              <h3 style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.3, margin: 0 }}>
                {t(item.keys.title)}
              </h3>
            </div>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6, margin: 0 }}>
              {t(item.keys.desc)}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
