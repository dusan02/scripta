declare global {
  interface Window {
    plausible?: (event: string, options?: { props?: Record<string, string | number | boolean> }) => void;
  }
}

export function trackEvent(
  event: string,
  props?: Record<string, string | number | boolean>,
) {
  if (typeof window !== "undefined" && window.plausible) {
    window.plausible(event, { props });
  }
}

export function trackPageview(url: string) {
  trackEvent("pageview", { url });
}

export function trackCheckoutComplete(planId: string, credits: number) {
  trackEvent("Checkout Complete", { planId, credits });
}

export function trackSignup(method: string) {
  trackEvent("Sign Up", { method });
}

export function trackReportCreated(ico: string) {
  trackEvent("Report Created", { ico });
}
