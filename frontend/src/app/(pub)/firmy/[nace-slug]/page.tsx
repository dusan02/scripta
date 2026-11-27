import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { renderHubPage, generateHubMetadata } from "@/components/hub-page";
import { slugToNaceSection, naceSectionToSlug, buildNaceCanonicalPath } from "@/lib/seo-url";
import { getNaceSections } from "@/lib/screener";

export const revalidate = 3600;
export const dynamicParams = true;

// Pre-render all 21 NACE section pages at build time
export function generateStaticParams() {
  return getNaceSections().map((s) => ({
    "nace-slug": naceSectionToSlug(s.section)!,
  }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ "nace-slug": string }>;
}): Promise<Metadata> {
  const { "nace-slug": naceSlug } = await params;
  const section = slugToNaceSection(naceSlug);
  if (!section) {
    return {
      title: "Odvetvie nenájdené",
      robots: { index: false, follow: false },
    };
  }
  const canonicalPath = buildNaceCanonicalPath(section)!;
  return generateHubMetadata({ section, canonicalPath });
}

export default async function NaceHubPage({
  params,
  searchParams,
}: {
  params: Promise<{ "nace-slug": string }>;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const { "nace-slug": naceSlug } = await params;
  const section = slugToNaceSection(naceSlug);
  if (!section) {
    return (
      <div className="min-h-screen" style={{ background: "var(--bg)" }}>
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <h1 className="text-2xl font-black mb-4" style={{ color: "var(--text)" }}>
            Odvetvie nenájdené
          </h1>
          <p style={{ color: "var(--text-secondary)" }}>
            Odvetvie s týmto názvom sa nenašlo.
          </p>
        </div>
      </div>
    );
  }

  const canonicalPath = buildNaceCanonicalPath(section)!;
  return renderHubPage({ section, canonicalPath }, searchParams, canonicalPath);
}
