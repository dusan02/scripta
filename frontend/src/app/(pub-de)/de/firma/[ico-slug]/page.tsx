import { FirmaPageContent, generateFirmaPageMetadata } from "@/components/firma-page";

// ISR: firma pages are fully cacheable — language comes from the URL route,
// no cookies/headers/searchParams in the render path (C0 audit 2026-09-06).
// revalidate=3600: company data changes at most daily (cron re-seed), so a
// 1h stale window is acceptable; dynamicParams=true renders on-demand —
// no 500k-page upfront build.
export const revalidate = 21600; // 6h — company data changes daily (cron re-seed); 1h caused needless re-renders under AI crawler load
export const dynamicParams = true;

// generateStaticParams with an EMPTY list + dynamicParams=true = on-demand
// ISR: nothing is prerendered at build (500k pages), but every request is
// rendered once, cached, and revalidated after 3600s. Without this function
// Next.js 14.2 treats the route as fully dynamic (no caching at all).
export function generateStaticParams() {
  return [];
}

type Params = { params: Promise<{ "ico-slug": string }> };

export async function generateMetadata({ params }: Params) {
  const { "ico-slug": icoSlug } = await params;
  return generateFirmaPageMetadata(icoSlug, "de");
}

export default async function Page({ params }: Params) {
  const { "ico-slug": icoSlug } = await params;
  return <FirmaPageContent icoSlug={icoSlug} lang="de" />;
}
