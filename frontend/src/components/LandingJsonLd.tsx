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
        "Automatizovaný Business Risk Report — finančné, právne a forenzné riziko firmy z 25+ štátnych registrov SR. Automatizované manažérske zhrnutie, mapa rizík podvodu, predikcia úpadku, alert na štátne pohľadávky, audítorský posudok a timeline právnych rizík v jednom PDF.",
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
      "@type": "Service",
      name: "Business Risk Report",
      provider: { "@type": "Organization", name: "Verifa.sk", url: "https://verifa.sk" },
      areaServed: { "@type": "Country", name: "Slovensko" },
      serviceType: "Due Diligence, Forenzný audit, Finančná analýza",
      description:
        "Automatizovaný Business Risk Report s automatizovaným manažérskym zhrnutím, mapou rizík podvodu, predikciou úpadku, alertom na štátne pohľadávky, audítorským posudkom a timeline právnych rizík.",
      hasOfferCatalog: {
        "@type": "OfferCatalog",
        itemListElement: [
          { "@type": "Offer", itemOffered: { "@type": "Service", name: "Automatizované manažérske zhrnutie" } },
          { "@type": "Offer", itemOffered: { "@type": "Service", name: "Mapa rizík podvodu (fraud heatmap)" } },
          { "@type": "Offer", itemOffered: { "@type": "Service", name: "Predikcia úpadku (insolvency score)" } },
          { "@type": "Offer", itemOffered: { "@type": "Service", name: "Alert na štátne pohľadávky" } },
          { "@type": "Offer", itemOffered: { "@type": "Service", name: "Audítorský posudok & Going Concern" } },
          { "@type": "Offer", itemOffered: { "@type": "Service", name: "Právne riziká & timeline udalostí" } },
        ],
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
            text: "Verifa.sk Business Risk Report je automatizovaný forenzný dokument, ktorý zhromažďuje dáta z 25+ verejných registrov Slovenskej republiky, vrátane ORSR, insolvenčných registrov, DPH registrov a RÚZ finančných výkazov. Výsledkom je profesionálny PDF report s automatizovaným manažérskym zhrnutím, mapou rizík podvodu, predikciou úpadku a záverečným Verifa Score.",
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
            text: "Report sa generuje automatizovane prostredníctvom headless prehliadača a analytickej engine. Väčšina reportov je hotových do niekoľkých minút od zadania IČO.",
          },
        },
        {
          "@type": "Question",
          name: "Obsahuje report automatizovaný posudok firmy?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Áno, každý report obsahuje automatizované manažérske zhrnutie v prirodzenom jazyku, ktoré identifikuje kľúčové riziká a odporúčania. Tento posudok je priamo vložiteľný do spisu alebo správy pre klienta — vhodné pre právnikov, notárov a účtovníkov.",
          },
        },
        {
          "@type": "Question",
          name: "Vie report predpovedať bankrot firmy?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Áno, report obsahuje Insolvency Score — algoritmický model, ktorý odhaduje pravdepodobnosť úpadku na základe Altman Z-Score, Piotroski F-Score, likvidity, zadlženosti a trendov. Doplnený o 3-4 trendy kľúčových ukazovateľov v čase.",
          },
        },
        {
          "@type": "Question",
          name: "Upozorní ma report na daňové dlhy firmy?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Áno, report obsahuje alert na štátne pohľadávky — upozornenie na daňové dlhy, sociálnu a zdravotné poisťovne. Ak firma dlží štátu, je vysoké riziko nezaplatenia faktúry. Systém tiež kontroluje Register úpadcov a insolvenčný register.",
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
