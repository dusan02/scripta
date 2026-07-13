"use client";

import LandingJsonLd from "@/components/LandingJsonLd";
import LandingNav from "@/components/landing/LandingNav";
import HeroSection from "@/components/landing/HeroSection";
import FeaturesSection from "@/components/landing/FeaturesSection";
import HowItWorksSection from "@/components/landing/HowItWorksSection";
import RegistriesSection from "@/components/landing/RegistriesSection";
import TargetSection from "@/components/landing/TargetSection";
import SampleReportSection from "@/components/landing/SampleReportSection";
import FaqSection from "@/components/landing/FaqSection";
import PricingSection from "@/components/landing/PricingSection";
import CtaSection from "@/components/landing/CtaSection";
import LandingFooter from "@/components/landing/LandingFooter";

export default function LandingPage() {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
      <LandingJsonLd />
      <style>{`
        @media (max-width: 768px) {
          .desktop-nav { display: none !important; }
          .mobile-nav { display: flex !important; }
          .how-steps { flex-direction: column !important; align-items: center !important; gap: 16px !important; }
          .how-step-card { width: 100% !important; max-width: 400px !important; }
          .how-arrow { display: none !important; }
          .footer-cols { flex-direction: column !important; gap: 32px !important; }
          .footer-links { gap: 24px !important; }
          .hero-stats { display: grid !important; grid-template-columns: 1fr 1fr !important; gap: 24px 16px !important; }
          .pricing-guarantee { flex-direction: column !important; gap: 16px !important; text-align: center !important; }
          .cta-card { padding: 40px 24px !important; }
          .section-pad { padding-top: 60px !important; padding-bottom: 60px !important; padding-left: 16px !important; padding-right: 16px !important; }
          .hero-pad { padding-top: 110px !important; padding-bottom: 60px !important; }
          .hero-cta { flex-direction: column !important; gap: 12px !important; }
          .hero-cta a { width: 100% !important; text-align: center !important; }
          .report-includes-grid { grid-template-columns: 1fr 1fr !important; gap: 20px 16px !important; }
          .pricing-grid { grid-template-columns: 1fr !important; }
          .features-grid { grid-template-columns: 1fr !important; }
          .registries-grid { grid-template-columns: 1fr !important; }
          .target-grid { grid-template-columns: 1fr !important; }
          .footer-bottom { justify-content: center !important; text-align: center !important; }
        }
        @media (min-width: 769px) {
          .desktop-nav { display: flex !important; }
          .mobile-nav { display: none !important; }
        }
      `}</style>
      <LandingNav />
      <HeroSection />
      <FeaturesSection />
      <HowItWorksSection />
      <RegistriesSection />
      <TargetSection />
      <SampleReportSection />
      <FaqSection />
      <PricingSection />
      <CtaSection />
      <LandingFooter />
    </div>
  );
}
