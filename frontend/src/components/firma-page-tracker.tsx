"use client";

import { useEffect } from "react";
import { trackFirmaPageView } from "@/lib/analytics";

/**
 * Fires a `firma_page_view` GA4 event on mount.
 * Mounted once per company page render — no deps, fires only once.
 */
export function FirmaPageTracker({ ico, hasRiskSignals, riskCount }: {
  ico: string;
  hasRiskSignals: boolean;
  riskCount: number;
}) {
  useEffect(() => {
    trackFirmaPageView(ico, hasRiskSignals, riskCount);
  }, []); // fire once on mount
  return null;
}
