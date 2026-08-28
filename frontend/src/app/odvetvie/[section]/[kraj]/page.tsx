import type { Metadata } from "next";
import { renderHubPage, generateHubMetadata } from "@/components/hub-page";
import { getNaceSections, getKrajOptions } from "@/lib/screener";

export const dynamic = "force-dynamic";
export const revalidate = 3600;

// Generate all NACE×kraj combos
export function generateStaticParams() {
  const sections = getNaceSections().map((s) => s.section);
  const kraje = getKrajOptions().map((k) => k.value);
  const params: Array<{ section: string; kraj: string }> = [];
  for (const section of sections) {
    for (const kraj of kraje) {
      params.push({ section, kraj });
    }
  }
  return params;
}

export async function generateMetadata({
  params,
}: {
  params: { section: string; kraj: string };
}): Promise<Metadata> {
  return generateHubMetadata({ section: params.section, kraj: params.kraj });
}

export default async function OdvetvieKrajPage({
  params,
  searchParams,
}: {
  params: { section: string; kraj: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  return renderHubPage(
    { section: params.section, kraj: params.kraj },
    searchParams,
    `/odvetvie/${params.section}/${params.kraj}`
  );
}
