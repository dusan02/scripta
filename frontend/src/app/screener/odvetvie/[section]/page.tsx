import { redirect } from "next/navigation";
import { getNaceSectionLabel, getNaceSections } from "@/lib/screener";

// Static params for all 21 NACE sections
export function generateStaticParams() {
  return getNaceSections().map(s => ({ section: s.section }));
}

export function generateMetadata({ params }: { params: { section: string } }) {
  const label = getNaceSectionLabel(params.section);
  if (!label) return { title: "Odvetvie nenájdené | Verifa.sk" };

  return {
    title: `Firmy — ${label} | Screener | Verifa.sk`,
    description: `Zoznam firiem v odvetví ${label.toLowerCase()} (NACE sekcia ${params.section}) — filtrovanie podľa regiónu, tržieb, zisku a ďalších ukazovateľov. Dáta z RÚZ a ORSR.`,
    robots: { index: true, follow: true },
    alternates: { canonical: `https://verifa.sk/screener/odvetvie/${params.section}` },
  };
}

export default function OdvetvieLandingPage({ params }: { params: { section: string } }) {
  const label = getNaceSectionLabel(params.section);
  if (!label) redirect("/screener");

  // Redirect to screener with naceSection filter
  redirect(`/screener?naceSection=${params.section}`);
}
