"use client";

const landingJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      name: "Verifa.sk",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description:
        "Automatizovaný Business Risk Report — finančné, právne a forenzné riziko firmy z štátnych registrov SR s AI analýzou finančného zdravia a semaformi nálezov.",
      url: "https://verifa.sk",
      offers: [
        {
          "@type": "Offer",
          price: "14.00",
          priceCurrency: "EUR",
          description: "1× Report — 1 report jednorazovo",
        },
        {
          "@type": "Offer",
          price: "89.00",
          priceCurrency: "EUR",
          description: "10× Report — 10 reportov jednorazovo",
        },
        {
          "@type": "Offer",
          price: "349.00",
          priceCurrency: "EUR",
          description: "50× Report — 50 reportov jednorazovo",
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
          name: "Čo je Verifa.sk Business Risk Report?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Verifa.sk Business Risk Report je automatizovaný forenzný dokument, ktorý zhromažďuje dáta z 25+ verejných registrov Slovenskej republiky, vrátane ORSR, insolvenčných registrov, DPH registrov a RÚZ finančných výkazov. Výsledkom je profesionálny PDF report s AI analýzou finančného zdravia a záverečným skóre dôveryhodnosti.",
          },
        },
        {
          "@type": "Question",
          name: "Koľko stojí Verifa.sk report?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Ponúkame tri balíčky: 1× Report (1 report za 14 € jednorazovo), 10× Report (10 reportov za 89 € jednorazovo) a 50× Report (50 reportov za 349 € jednorazovo). Pri registrácii dostanete 1 skúšobný kredit zadarmo. Kredity neexpirujú."
          },
        },
        {
          "@type": "Question",
          name: "Aké registre sa kontrolujú v reporte?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Report kontroluje 25+ verejných registrov vrátane Obchodného registra (ORSR), Živnostenského registra (ZRSR), insolvenčných registrov, registrov daňových dlžníkov, DPH registrov, Obchodného vestníka, RÚZ finančných výkazov a ďalších.",
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
