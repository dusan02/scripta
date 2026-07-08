import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cenník",
  description: "Vyberte si balíček reportov na Verifa.sk — od jednorazového reportu po mesačné predplatné.",
  alternates: {
    canonical: "https://verifa.sk/pricing",
  },
  openGraph: {
    title: "Cenník | Verifa.sk",
    description: "Vyberte si balíček reportov na Verifa.sk — od jednorazového reportu po mesačné predplatné.",
    url: "https://verifa.sk/pricing",
    type: "website",
    locale: "sk_SK",
    siteName: "Verifa.sk",
  },
};

export default function PricingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
