const landingJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      name: "Verifa.sk",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description:
        "Automatizovaná príprava komplexných due diligence reportov — zlúčené PDF výpisy zo štátnych registrov SR s AI analýzou finančného zdravia a semaformi nálezov.",
      url: "https://verifa.sk",
      offers: [
        {
          "@type": "Offer",
          price: "14.00",
          priceCurrency: "EUR",
          description: "PAYG 1 — 1 report jednorazovo",
        },
        {
          "@type": "Offer",
          price: "59.00",
          priceCurrency: "EUR",
          description: "Pay-as-you-go 5 — 5 reportov jednorazovo",
        },
        {
          "@type": "Offer",
          price: "199.00",
          priceCurrency: "EUR",
          description: "Pay-as-you-go 20 — 20 reportov jednorazovo",
        },
        {
          "@type": "Offer",
          price: "49.00",
          priceCurrency: "EUR",
          description: "Freelance — 5 reportov mesačne",
        },
        {
          "@type": "Offer",
          price: "129.00",
          priceCurrency: "EUR",
          description: "Firma — 18 reportov mesačne",
        },
        {
          "@type": "Offer",
          price: "239.00",
          priceCurrency: "EUR",
          description: "Korporát — 40 reportov mesačne",
        },
      ],
      provider: {
        "@type": "Organization",
        name: "Verifa.sk",
        url: "https://verifa.sk",
      },
    },
    {
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: "Čo je Verifa.sk due diligence report?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Verifa.sk report je automatizovaný forenzný dokument, ktorý zhromažďuje dáta z 25 verejných a privátnych registrov Slovenskej republiky, vrátane ORSR, insolvenčných registrov, DPH registrov a RÚZ finančných výkazov. Výsledkom je profesionálny PDF report s AI analýzou finančného zdravia a záverečným skóre dôveryhodnosti.",
          },
        },
        {
          "@type": "Question",
          name: "Koľko stojí Verifa.sk report?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Ponúkame šesť plánov: Štart (1 report za 14 € jednorazovo), Pay-as-you-go 5 (5 reportov za 59 € jednorazovo), Pay-as-you-go 20 (20 reportov za 199 € jednorazovo), Freelance (5 reportov za 49 €/mesiac), Firma (18 reportov za 129 €/mesiac) a Korporát (40 reportov za 239 €/mesiac). Pri registrácii dostanete 1 skúšobný kredit zadarmo na 30 dní."
          },
        },
        {
          "@type": "Question",
          name: "Aké registre sa kontrolujú v reporte?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Report kontroluje 25 verejných a privátnych registrov vrátane Obchodného registra (ORSR), Živnostenského registra (ZRSR), insolvenčných registrov, registrov daňových dlžníkov, DPH registrov, Obchodného vestníka, RÚZ finančných výkazov a ďalších.",
          },
        },
        {
          "@type": "Question",
          name: "Ako rýchlo dostanem report?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Report sa generuje automatizovane prostredníctvom headless prehliadača a AI analýzy. Väčšina reportov je hotových do niekoľkých minút od zadania IČO.",
          },
        },
      ],
    },
  ],
};

export default function LandingJsonLd() {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(landingJsonLd) }}
    />
  );
}
