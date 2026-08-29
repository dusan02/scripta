declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
  }
}

export function trackEvent(
  event: string,
  props?: Record<string, string | number | boolean>,
) {
  if (typeof window !== "undefined" && window.gtag) {
    window.gtag("event", event, props);
  }
}

export function trackPageview(url: string) {
  if (typeof window !== "undefined" && window.gtag) {
    window.gtag("event", "page_view", { page_location: url });
  }
}

export function trackCheckoutComplete(planId: string, credits: number) {
  trackEvent("purchase_completed", { plan_id: planId, credits });
}

export function trackCheckoutStarted(planId: string) {
  trackEvent("checkout_started", { plan_id: planId });
}

export function trackSignup(method: string) {
  trackEvent("sign_up", { method });
}

export function trackReportCreated(ico: string) {
  trackEvent("report_created", { ico });
}

export function trackReportStarted(ico: string) {
  trackEvent("report_started", { ico });
}

// ── Company page tracking ──

export function trackFirmaPageView(ico: string, hasRiskSignals: boolean, riskCount: number) {
  trackEvent("firma_page_view", {
    ico,
    has_risk_signals: hasRiskSignals,
    risk_count: riskCount,
  });
}

export function trackReportCtaClick(ico: string, location: "sticky_header" | "preverte_firmu" | "faq") {
  trackEvent("report_cta_click", {
    ico,
    cta_location: location,
  });
}

export function trackPricingClick(ico: string) {
  trackEvent("pricing_click", {
    ico,
    source: "firma_page",
  });
}
