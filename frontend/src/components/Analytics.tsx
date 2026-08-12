"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    dataLayer?: any[];
    gtag?: (...args: any[]) => void;
  }
}

export default function Analytics() {
  const gaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

  useEffect(() => {
    if (!gaId) return;

    // Load gtag.js
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${gaId}`;
    document.head.appendChild(script);

    // Init dataLayer + config
    window.dataLayer = window.dataLayer || [];
    function gtag(...args: any[]) {
      window.dataLayer!.push(args);
    }
    gtag("js", new Date());
    gtag("config", gaId, {
      anonymize_ip: true,
      send_page_view: true,
    });

    // Expose gtag globally for analytics.ts
    window.gtag = gtag;
  }, [gaId]);

  return null;
}
