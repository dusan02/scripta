import { permanentRedirect, notFound } from "next/navigation";
import { getNaceSections } from "@/lib/screener";
import { naceSectionToSlug } from "@/lib/seo-url";

export const revalidate = 3600;

// Keep generateStaticParams so the route is pre-rendered (and redirect is fast)
export function generateStaticParams() {
  return getNaceSections().map((s) => ({ section: s.section }));
}

export default async function OdvetvieRedirect({
  params,
}: {
  params: { section: string };
}) {
  const slug = naceSectionToSlug(params.section);
  if (slug) {
    permanentRedirect(`/firmy/${slug}`);
  }
  notFound();
}
