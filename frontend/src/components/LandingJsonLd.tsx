"use client";

import { useLang } from "@/components/LanguageProvider";
import { getServiceJsonLd, getFaqJsonLd } from "@/lib/seo";
import { safeJsonLd } from "@/lib/seo/safe-json-ld";

export default function LandingJsonLd() {
  const { lang } = useLang();
  const serviceJsonLd = getServiceJsonLd(lang);
  const faqJsonLd = getFaqJsonLd(lang);

  return (
    <>
      {serviceJsonLd.map((schema, i) => (
        <script
          key={`service-${i}`}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLd(schema) }}
        />
      ))}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(faqJsonLd) }}
      />
    </>
  );
}
