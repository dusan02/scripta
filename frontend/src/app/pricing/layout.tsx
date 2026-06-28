import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cenník",
  description: "Vyberte si balíček reportov na Verifa.sk — od jednorazového reportu po mesačné predplatné.",
};

export default function PricingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
