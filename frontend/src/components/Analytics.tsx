"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

declare global {
  interface Window {
    dataLayer?: any[];
    gtag?: (...args: any[]) => void;
  }
}

const CONSENT_KEY = "verifa-cookie-consent";

export function hasAnalyticsConsent(): boolean {
  if (typeof window === "undefined") return false;
  const raw = localStorage.getItem(CONSENT_KEY);
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw);
    return !parsed.declined;
  } catch {
    return false;
  }
}

export function loadGA4(gaId: string) {
  if (window.gtag) return;

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    window.dataLayer!.push(arguments);
  };
  // Consent Mode v2 — the cookie banner already granted analytics consent
  // (loadGA4 only runs after "Prijať"), so declare it before gtag.js loads.
  // Without it, hits carry denied consent signals (npa/dma/gcd) and GA4
  // drops them from reports as cookieless pings.
  (window.gtag as any)("consent", "default", {
    analytics_storage: "granted",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${gaId}`;
  document.head.appendChild(script);

  (window.gtag as any)("js", new Date());
  (window.gtag as any)("config", gaId, {
    anonymize_ip: true,
    send_page_view: true,
  });
}

export default function Analytics() {
  const gaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
  const pathname = usePathname();
  const [consentGranted, setConsentGranted] = useState(false);

  useEffect(() => {
    setConsentGranted(hasAnalyticsConsent());

    const onConsentChange = () => setConsentGranted(hasAnalyticsConsent());
    window.addEventListener("cookie-consent-change", onConsentChange);
    window.addEventListener("storage", onConsentChange);
    return () => {
      window.removeEventListener("cookie-consent-change", onConsentChange);
      window.removeEventListener("storage", onConsentChange);
    };
  }, []);

  useEffect(() => {
    if (!gaId || !consentGranted) return;
    loadGA4(gaId);
  }, [gaId, consentGranted]);

  // Track SPA route transitions after initial GA4 load
  useEffect(() => {
    if (!gaId || !consentGranted || typeof window === "undefined" || !window.gtag) return;
    (window.gtag as any)("config", gaId, {
      page_path: pathname + (window.location.search || ""),
    });
  }, [gaId, consentGranted, pathname]);

  return null;
}
