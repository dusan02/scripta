import type { Metadata } from "next";
import { headers } from "next/headers";
import { getLangFromHeaders, generatePageMetadata } from "@/lib/seo";
import { safeJsonLd } from "@/lib/seo/safe-json-ld";

export async function generateMetadata(): Promise<Metadata> {
  const h = await headers();
  const lang = getLangFromHeaders(h);
  return generatePageMetadata("pricing", lang);
}

// FAQPage JSON-LD — pricing-specific Q&A for rich snippets and AI engines
const PRICING_FAQ_JSONLD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "Koľko stojí Business Risk Report?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Jeden report stojí 14 €. Pri balíku 10 reportov zaplatíte 89 € (8,90 € za report) a pri balíku 50 reportov 349 € (6,98 € za report). Každý report je jedno PDF preverenie konkrétnej firmy podľa IČO.",
      },
    },
    {
      "@type": "Question",
      name: "Aké platobné metódy akceptujete?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Prijímame platobné karty (Visa, Mastercard, American Express), Apple Pay, Google Pay, PayPal a SEPA bankový prevod. Platby spracúva Paddle ako merchant of record.",
      },
    },
    {
      "@type": "Question",
      name: "Ako rýchlo dostanem hotový report?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Väčšina reportov je hotových do 10–15 minút od zadania IČO. Hotový PDF report si môžete stiahnuť a zdieľať bez obmedzení.",
      },
    },
    {
      "@type": "Question",
      name: "Čo sa stane, ak sa report nevygeneruje?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Ak z dôvodu výpadku štátnych registrov nie je možné report vygenerovať, vrátime vám plnú sumu alebo vám pripíšeme kredit na nový report.",
      },
    },
    {
      "@type": "Question",
      name: "Môžem report použiť pri due diligence?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Áno. Report je PDF bez vodoznaku pripravené na zdieľanie — môžete ho priložiť do spisu, poslať klientovi alebo archivovať. Je to informačný nástroj pre due diligence, nenahrádza právne ani daňové poradenstvo.",
      },
    },
  ],
};

export default function PricingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(PRICING_FAQ_JSONLD) }}
      />
      {children}
    </>
  );
}
