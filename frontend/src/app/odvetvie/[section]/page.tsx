import type { Metadata } from "next";
import { renderHubPage, generateHubMetadata } from "@/components/hub-page";
import { getNaceSections } from "@/lib/screener";

export const dynamic = "force-dynamic";
export const revalidate = 3600;

// Static params for all NACE sections
export function generateStaticParams() {
  return getNaceSections().map((s) => ({ section: s.section }));
}

export async function generateMetadata({
  params,
}: {
  params: { section: string };
}): Promise<Metadata> {
  return generateHubMetadata({ section: params.section });
}

export default async function OdvetviePage({
  params,
  searchParams,
}: {
  params: { section: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  return renderHubPage({ section: params.section }, searchParams, `/odvetvie/${params.section}`);
}
