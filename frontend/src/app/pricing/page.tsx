"use client";

import { useState } from "react";

const PACKAGES = [
  {
    id: "basic",
    name: "Basic",
    reports: 50,
    price: 29,
    pricePerReport: "0,58",
    features: [
      "50 reportov mesačne",
      "Všetky registre (ORSR, ZRSR, RPO, RPVS, ...)",
      "Insolvenčný register a exek\u00facie",
      "Finan\u010dn\u00e1 spr\u00e1va a DPH registre",
      "Register diskvalifik\u00e1ci\u00ed",
      "Z\u00e1lo\u017en\u00e9 pr\u00e1va a dra\u017eby",
      "AI posudok a z\u00e1vere\u010dn\u00e9 sk\u00f3re",
      "PDF export s n\u00e1vodmi",
    ],
    highlight: false,
  },
  {
    id: "biznis",
    name: "Biznis",
    reports: 200,
    price: 69,
    pricePerReport: "0,35",
    features: [
      "200 reportov mesa\u010dne",
      "V\u0161etky registre (ORSR, ZRSR, RPO, RPVS, ...)",
      "Insolven\u010dn\u00fd register a exek\u00facie",
      "Finan\u010dn\u00e1 spr\u00e1va a DPH registre",
      "Register diskvalifik\u00e1ci\u00ed",
      "Z\u00e1lo\u017en\u00e9 pr\u00e1va a dra\u017eby",
      "AI posudok a z\u00e1vere\u010dn\u00e9 sk\u00f3re",
      "PDF export s n\u00e1vodmi",
    ],
    highlight: true,
  },
  {
    id: "pro",
    name: "Pro",
    reports: 500,
    price: 149,
    pricePerReport: "0,30",
    features: [
      "500 reportov mesa\u010dne",
      "V\u0161etky registre (ORSR, ZRSR, RPO, RPVS, ...)",
      "Insolven\u010dn\u00fd register a exek\u00facie",
      "Finan\u010dn\u00e1 spr\u00e1va a DPH registre",
      "Register diskvalifik\u00e1ci\u00ed",
      "Z\u00e1lo\u017en\u00e9 pr\u00e1va a dra\u017eby",
      "AI posudok a z\u00e1vere\u010dn\u00e9 sk\u00f3re",
      "PDF export s n\u00e1vodmi",
    ],
    highlight: false,
  },
];

export default function PricingPage() {
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);

  return (
    <div className="max-w-[900px] mx-auto px-4 sm:px-6 pt-8 pb-8 animate-fade-in">
      <div className="text-center mb-10">
        <h1
          className="text-2xl font-bold tracking-tight mb-1"
          style={{ color: "var(--text)", letterSpacing: "-0.02em" }}
        >
          Cenník
        </h1>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Vyberte si balíček, ktorý vám vyhovuje. Môžete kedykoľvek zmeniť alebo zrušiť.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {PACKAGES.map((pkg) => {
          const isSelected = selectedPlan === pkg.id;
          return (
            <div
              key={pkg.id}
              className="card p-6 flex flex-col transition-all"
              style={{
                border: isSelected
                  ? "2px solid var(--accent)"
                  : "1px solid var(--border)",
                background: "var(--surface)",
                position: "relative",
              }}
            >
              {pkg.highlight && (
                <div
                  className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-[10px] font-semibold"
                  style={{
                    background: "var(--accent)",
                    color: "white",
                  }}
                >
                  Najobľúbenejší
                </div>
              )}

              <div className="text-center mb-5">
                <h2
                  className="text-lg font-bold mb-1"
                  style={{ color: "var(--text)" }}
                >
                  {pkg.name}
                </h2>
                <div className="flex items-baseline justify-center gap-1">
                  <span
                    className="text-3xl font-bold"
                    style={{ color: "var(--text)" }}
                  >
                    {pkg.price}
                  </span>
                  <span className="text-sm" style={{ color: "var(--text-muted)" }}>
                    € / mesiac
                  </span>
                </div>
                <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                  {pkg.reports} reportov · {pkg.pricePerReport} € / report
                </p>
              </div>

              <ul className="flex-1 flex flex-col gap-2 mb-6">
                {pkg.features.map((feature, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-xs"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 12 12"
                      fill="none"
                      className="flex-shrink-0 mt-0.5"
                    >
                      <path
                        d="M2 6l3 3 5-5"
                        stroke="var(--accent)"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    {feature}
                  </li>
                ))}
              </ul>

              <button
                onClick={() => setSelectedPlan(pkg.id)}
                className="w-full py-2.5 rounded-lg text-sm font-semibold transition-all"
                style={{
                  background: isSelected ? "var(--accent)" : "transparent",
                  color: isSelected ? "white" : "var(--text)",
                  border: isSelected ? "none" : "1px solid var(--border)",
                  cursor: "pointer",
                }}
              >
                {isSelected ? "Vybrané ✓" : "Vybrať"}
              </button>
            </div>
          );
        })}
      </div>

      <div className="text-center mt-8">
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Potrebujete viac reportov? Kontaktujte nás na{" "}
          <a
            href="mailto:info@veriso.sk"
            className="font-medium"
            style={{ color: "var(--accent)" }}
          >
            info@veriso.sk
          </a>
        </p>
      </div>
    </div>
  );
}
