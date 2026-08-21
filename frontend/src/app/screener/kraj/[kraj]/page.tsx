import { redirect } from "next/navigation";
import { getKrajLabel, getKrajOptions } from "@/lib/screener";

// Static params for all 8 kraje
export function generateStaticParams() {
  return getKrajOptions().map(k => ({ kraj: k.value }));
}

export function generateMetadata({ params }: { params: { kraj: string } }) {
  const label = getKrajLabel(params.kraj);
  if (!label) return { title: "Kraj nenájdený | Verifa.sk" };

  return {
    title: `Firmy v ${label} | Screener | Verifa.sk`,
    description: `Zoznam firiem v ${label.toLowerCase()} — filtrovanie podľa odvetvia, právnej formy, tržieb, zisku a ďalších ukazovateľov. Dáta z RÚZ a ORSR.`,
    robots: { index: true, follow: true },
    alternates: { canonical: `https://verifa.sk/screener/kraj/${params.kraj}` },
  };
}

export default function KrajLandingPage({ params }: { params: { kraj: string } }) {
  const label = getKrajLabel(params.kraj);
  if (!label) redirect("/screener");

  // Redirect to screener with kraj filter
  redirect(`/screener?kraj=${params.kraj}`);
}
