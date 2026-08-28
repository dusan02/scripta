import type { Metadata } from "next";
import { renderHubPage, generateHubMetadata } from "@/components/hub-page";
import { OKRES_CODE_TO_NAME } from "@/lib/okres-map";

export const revalidate = 3600;

export function generateStaticParams() {
  return Object.keys(OKRES_CODE_TO_NAME).map((okres) => ({ okres }));
}

export async function generateMetadata({
  params,
}: {
  params: { okres: string };
}): Promise<Metadata> {
  return generateHubMetadata({ okres: params.okres });
}

export default async function OkresPage({
  params,
  searchParams,
}: {
  params: { okres: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  return renderHubPage({ okres: params.okres }, searchParams, `/okres/${params.okres}`);
}
