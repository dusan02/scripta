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
      offers: {
        "@type": "Offer",
        price: "19.49",
        priceCurrency: "EUR",
        description: "Jednorazový report",
      },
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
            text: "Verifa.sk report je automatizovaný forenzný dokument, ktorý zhromažďuje dáta z viac ako 30 verejných registrov Slovenskej republiky, vrátane ORSR, insolvenčných registrov, DPH registrov a RÚZ finančných výkazov. Výsledkom je profesionálny PDF report s AI analýzou finančného zdravia a záverečným skóre dôveryhodnosti.",
          },
        },
        {
          "@type": "Question",
          name: "Koľko stojí Verifa.sk report?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Jednorazový report stojí 10 €. Pre pravidelné použitie ponúkame balíky: Basic (10 reportov za 49 €), Business (30 reportov za 129 €) a Pro (100 reportov za 249 €).",
          },
        },
        {
          "@type": "Question",
          name: "Aké registre sa kontrolujú v reporte?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Report kontroluje viac ako 30 verejných registrov vrátane Obchodného registra (ORSR), Živnostenského registra (ZRSR), insolvenčných registrov, registrov daňových dlžníkov, DPH registrov, Obchodného vestníka, RÚZ finančných výkazov a ďalších.",
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
