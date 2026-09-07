import { permanentRedirect, notFound } from "next/navigation";
import { getNaceSections, getKrajOptions } from "@/lib/screener";
import { naceSectionToSlug, krajToSlug } from "@/lib/seo-url";

export const revalidate = 3600;

// Keep generateStaticParams so the route is pre-rendered (and redirect is fast)
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

export default async function OdvetvieKrajRedirect({
  params,
}: {
  params: { section: string; kraj: string };
}) {
  const naceSlug = naceSectionToSlug(params.section);
  const krajSlug = krajToSlug(params.kraj);
  if (naceSlug && krajSlug) {
    permanentRedirect(`/firmy/${naceSlug}/${krajSlug}`);
  }
  notFound();
}
