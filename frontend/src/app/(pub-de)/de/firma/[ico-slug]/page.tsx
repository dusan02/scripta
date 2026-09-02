import { FirmaPageContent, generateFirmaPageMetadata } from "@/components/firma-page";

export const dynamic = "force-dynamic";
export const dynamicParams = true;

type Params = { params: Promise<{ "ico-slug": string }> };

export async function generateMetadata({ params }: Params) {
  const { "ico-slug": icoSlug } = await params;
  return generateFirmaPageMetadata(icoSlug, "de");
}

export default async function Page({ params }: Params) {
  const { "ico-slug": icoSlug } = await params;
  return <FirmaPageContent icoSlug={icoSlug} lang="de" />;
}
