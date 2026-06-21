"use client";

interface Package {
  id: string;
  name: string;
  credits: number;
  price: string;
  perCredit: string;
  popular: boolean;
}

const CREDIT_PACKAGES: Package[] = [
  { id: "small", name: "Štartér", credits: 20, price: "9,90 €", perCredit: "0,50 €/kr.", popular: false },
  { id: "medium", name: "Profesionál", credits: 60, price: "24,90 €", perCredit: "0,42 €/kr.", popular: true },
  { id: "large", name: "Kancelária", credits: 150, price: "49,90 €", perCredit: "0,33 €/kr.", popular: false },
];

export default function CreditPackages() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {CREDIT_PACKAGES.map((pkg) => (
        <div
          key={pkg.id}
          className={`relative rounded-xl p-4 border transition-all duration-200 cursor-pointer hover:border-emerald-500/30 ${
            pkg.popular ? "border-emerald-500/30" : ""
          }`}
          style={{
            background: pkg.popular
              ? "rgba(16,185,129,0.05)"
              : "rgba(255,255,255,0.03)",
            borderColor: pkg.popular
              ? "rgba(16,185,129,0.25)"
              : "rgba(255,255,255,0.07)",
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
          <div className="text-sm font-bold text-slate-200 mb-1">{pkg.name}</div>
          <div className="text-2xl font-extrabold text-white">
            {pkg.credits}{" "}
            <span className="text-sm font-normal text-slate-400">kreditov</span>
          </div>
          <div className="text-lg font-bold text-emerald-400 mt-1">{pkg.price}</div>
          <div className="text-xs text-slate-600 mb-3">{pkg.perCredit}</div>
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
