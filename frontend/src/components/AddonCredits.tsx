"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/components/LanguageProvider";
import Link from "next/link";
import toast from "react-hot-toast";

interface AddonCreditsProps {
  balance: number;
  planName: string | null;
}

const ADDON_CREDITS = 5;
const ADDON_PRICE = process.env.NEXT_PUBLIC_ADDON_PRICE || "59";
const ADDON_PRICE_PER_REPORT = "11,80";

const UPSELL_MAP: Record<string, string> = {
  freelance: "firma",
  firma: "korporat",
};

export default function AddonCredits({ balance, planName }: AddonCreditsProps) {
  const t = useT();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const handleCheckout = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: "addon5" }),
      });
      const data = await res.json();
      if (res.ok && data.url) {
        router.push(data.url);
      } else {
        toast.error(t("addon.checkoutChyba"));
      }
    } catch {
      toast.error(t("addon.checkoutChyba"));
    } finally {
      setLoading(false);
    }
  }, [router, t]);

  if (dismissed || balance > 0 || !planName || planName === "start") {
    return null;
  }

  const upsellPlan = UPSELL_MAP[planName];

  return (
    <div
      className="rounded-xl p-5 mb-6 animate-fade-in"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--warning)",
        boxShadow: "0 0 0 3px var(--warning-bg)",
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <h3 className="text-sm font-bold" style={{ color: "var(--text)" }}>
              {t("addon.nadpis")}
            </h3>
          </div>
          <p className="text-xs mb-1" style={{ color: "var(--text-secondary)" }}>
            {t("addon.popis")}
          </p>
          <div className="flex items-baseline gap-2 mb-3">
            <span className="text-lg font-bold" style={{ color: "var(--text)" }}>59 €</span>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>{t("addon.cenaZaReport")}</span>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={handleCheckout}
              disabled={loading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all hover:brightness-110"
              style={{
                background: "var(--accent)",
                color: "var(--accent-button-text, white)",
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? (
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
                  <path d="M12 2a10 10 0 010 20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              ) : null}
              {loading ? t("addon.presmerovanie") : t("addon.kupit")}
            </button>

            {upsellPlan && (
              <Link
                href="/pricing"
                className="text-xs font-medium transition-colors hover:opacity-80"
                style={{ color: "var(--accent)" }}
              >
                {t("addon.upsell", { plan: t(`pricing.${upsellPlan}`) })}
              </Link>
            )}
          </div>
        </div>

        <button
          onClick={() => setDismissed(true)}
          className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
          style={{
            color: "var(--text-muted)",
            background: "var(--bg-muted)",
          }}
          title={t("addon.zavriet")}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
