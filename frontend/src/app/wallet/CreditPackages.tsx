"use client";

import { CREDIT_PACKAGES } from "@/lib/creditPackages";

export default function CreditPackages() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {CREDIT_PACKAGES.map((pkg) => (
        <div
          key={pkg.id}
          className={`relative rounded-xl p-4 border transition-all duration-200 cursor-pointer ${
            pkg.popular ? "" : ""
          }`}
          style={{
            background: pkg.popular
              ? "var(--accent-light)"
              : "var(--bg-muted)",
            borderColor: pkg.popular
              ? "var(--accent-border)"
              : "var(--border)",
          }}
        >
          {pkg.popular && (
            <div
              className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: "#10b981", color: "white" }}
            >
              POPULÁRNY
            </div>
          )}
          <div className="text-sm font-bold mb-1" style={{ color: "var(--text)" }}>{pkg.name}</div>
          <div className="text-2xl font-extrabold" style={{ color: "var(--text)" }}>
            {pkg.credits}{" "}
            <span className="text-sm font-normal" style={{ color: "var(--text-muted)" }}>kreditov</span>
          </div>
          <div className="text-lg font-bold mt-1" style={{ color: "var(--accent)" }}>{pkg.priceEur}</div>
          <div className="text-xs mb-3" style={{ color: "var(--text-muted)" }}>{pkg.perCredit}</div>
          <button
            id={`topup-${pkg.id}-btn`}
            className={`w-full py-2 rounded-lg text-xs font-semibold transition-all duration-200 ${
              pkg.popular ? "btn-primary" : "btn-secondary"
            }`}
            onClick={() =>
              alert(
                `Stripe platba pre balík "${pkg.name}" — integrácia cez Stripe Elements (viď /api/stripe/checkout)`
              )
            }
          >
            Kúpiť
          </button>
        </div>
      ))}
    </div>
  );
}
