"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const GUEST_PLANS = [
  { id: "payg1", label: "1 report", price: "14 €" },
  { id: "payg10", label: "10 reportov", price: "89 €" },
  { id: "payg50", label: "50 reportov", price: "349 €" },
];

function ObjednatForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [ico, setIco] = useState(params.get("ico") || "");
  const [email, setEmail] = useState("");
  const planParam = params.get("plan");
  const [planId, setPlanId] = useState(
    GUEST_PLANS.some((p) => p.id === planParam) ? planParam! : "payg1"
  );
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [error, setError] = useState("");

  // Logged-in users keep the existing dashboard flow (credits, source picker).
  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((s) => {
        if (s?.user) {
          const icoParam = params.get("ico");
          router.replace(icoParam ? `/dashboard?ico=${icoParam}` : "/dashboard");
        } else {
          setCheckingSession(false);
        }
      })
      .catch(() => setCheckingSession(false));
  }, [params, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!/^\d{8}$/.test(ico)) {
      setError("IČO musí obsahovať presne 8 číslic.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/billing/guest-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ico, email, planId }),
      });
      const data = await res.json();
      if (res.ok && data.url) {
        router.push(data.url);
      } else {
        setError(data.error || "Objednávku sa nepodarilo vytvoriť. Skúste to znova.");
        setLoading(false);
      }
    } catch {
      setError("Objednávku sa nepodarilo vytvoriť. Skúste to znova.");
      setLoading(false);
    }
  };

  if (checkingSession) {
    return <div className="min-h-[50vh]" />;
  }

  return (
    <div className="max-w-[480px] mx-auto px-4 sm:px-6 pt-10 pb-16 animate-fade-in">
      <h1 className="text-2xl font-bold tracking-tight mb-2" style={{ color: "var(--text)" }}>
        Objednať Business Risk Report
      </h1>
      <p className="text-sm mb-6" style={{ color: "var(--text-secondary)" }}>
        Bez registrácie — zadajte IČO a e-mail, zaplaťte a report vám pošleme na e-mail
        (zvyčajne do 15 minút). Zároveň vám vytvoríme účet pre prístup k reportu.
      </p>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="ico" className="block text-sm font-medium mb-1" style={{ color: "var(--text)" }}>
            IČO firmy
          </label>
          <input
            id="ico"
            type="text"
            inputMode="numeric"
            value={ico}
            onChange={(e) => setIco(e.target.value.replace(/\D/g, "").slice(0, 8))}
            placeholder="napr. 35707442"
            required
            className="w-full rounded-lg px-3 py-2.5 text-sm"
            style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }}
          />
        </div>

        <div>
          <label htmlFor="email" className="block text-sm font-medium mb-1" style={{ color: "var(--text)" }}>
            E-mail na doručenie reportu
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="vas@email.sk"
            required
            className="w-full rounded-lg px-3 py-2.5 text-sm"
            style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }}
          />
        </div>

        <div>
          <span className="block text-sm font-medium mb-1" style={{ color: "var(--text)" }}>
            Balík
          </span>
          <div className="space-y-2">
            {GUEST_PLANS.map((p) => (
              <label
                key={p.id}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 cursor-pointer text-sm"
                style={{
                  background: "var(--surface)",
                  border: `1px solid ${planId === p.id ? "var(--accent)" : "var(--border)"}`,
                  color: "var(--text)",
                }}
              >
                <input
                  type="radio"
                  name="plan"
                  value={p.id}
                  checked={planId === p.id}
                  onChange={() => setPlanId(p.id)}
                />
                <span className="flex-1">{p.label}</span>
                <span className="font-bold">{p.price}</span>
              </label>
            ))}
          </div>
          {planId !== "payg1" && (
            <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
              Prvý report sa vygeneruje pre zadané IČO, zvyšné kredity ostanú na vašom účte.
            </p>
          )}
        </div>

        {error && (
          <p className="text-sm" style={{ color: "var(--danger)" }}>{error}</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full px-6 py-3 rounded-xl font-bold text-sm transition-all hover:scale-[1.02]"
          style={{
            background: "var(--accent)",
            color: "var(--accent-button-text)",
            boxShadow: "var(--glow-accent)",
            opacity: loading ? 0.6 : 1,
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Presmerúvam do platobnej brány…" : "Pokračovať na platbu"}
        </button>
      </form>

      <p className="text-xs mt-4 text-center" style={{ color: "var(--text-muted)" }}>
        Platba cez Paddle — bezpečná platobná brána. Registrácia nie je potrebná.
      </p>
    </div>
  );
}

export default function ObjednatPage() {
  return (
    <Suspense fallback={<div className="min-h-[50vh]" />}>
      <ObjednatForm />
    </Suspense>
  );
}
