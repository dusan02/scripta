import { FirmaPageContent, generateFirmaPageMetadata } from "@/components/firma-page";

export const dynamic = "force-static";
export const dynamicParams = true;
export const revalidate = 86400;

type Params = { params: Promise<{ "ico-slug": string }> };

export async function generateMetadata({ params }: Params) {
  const { "ico-slug": icoSlug } = await params;
  return generateFirmaPageMetadata(icoSlug, "en");
}

export default async function Page({ params }: Params) {
  const { "ico-slug": icoSlug } = await params;
  return <FirmaPageContent icoSlug={icoSlug} lang="en" />;
}
