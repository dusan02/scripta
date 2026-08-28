import type { Metadata } from "next";
import { renderHubPage, generateHubMetadata } from "@/components/hub-page";
import { getKrajOptions } from "@/lib/screener";

export const dynamic = "force-dynamic";
export const revalidate = 3600;

export function generateStaticParams() {
  return getKrajOptions().map((k) => ({ kraj: k.value }));
}

export async function generateMetadata({
  params,
}: {
  params: { kraj: string };
}): Promise<Metadata> {
  return generateHubMetadata({ kraj: params.kraj });
}

export default async function KrajPage({
  params,
  searchParams,
}: {
  params: { kraj: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  return renderHubPage({ kraj: params.kraj }, searchParams, `/kraj/${params.kraj}`);
}
