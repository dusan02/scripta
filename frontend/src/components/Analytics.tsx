"use client";

import { useEffect, useState } from "react";

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

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${gaId}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    window.dataLayer!.push(arguments);
  };
  (window.gtag as any)("js", new Date());
  (window.gtag as any)("config", gaId, {
    anonymize_ip: true,
    send_page_view: true,
  });
}

export default function Analytics() {
  const gaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
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

  return null;
}
