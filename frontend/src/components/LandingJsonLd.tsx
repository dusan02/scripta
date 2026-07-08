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
          description: "Štart — 1 report jednorazovo",
        },
        {
          "@type": "Offer",
          price: "49.00",
          priceCurrency: "EUR",
          description: "Freelance — 10 reportov mesačne",
        },
        {
          "@type": "Offer",
          price: "99.00",
          priceCurrency: "EUR",
          description: "Firma — 25 reportov mesačne",
        },
        {
          "@type": "Offer",
          price: "249.00",
          priceCurrency: "EUR",
          description: "Korporát — 60 reportov mesačne",
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
            text: "Ponúkame štyri plány: Štart (1 report za 14 € jednorazovo), Freelance (10 reportov za 49 €/mesiac), Firma (25 reportov za 99 €/mesiac) a Korporát (60 reportov za 249 €/mesiac). Pri registrácii dostanete 5 skúšobných kreditov zadarmo na 30 dní."
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
