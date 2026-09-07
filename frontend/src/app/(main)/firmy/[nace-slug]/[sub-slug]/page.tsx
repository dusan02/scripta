import type { Metadata } from "next";
import { renderHubPage, generateHubMetadata } from "@/components/hub-page";
import { resolveCitySlug } from "@/lib/hub";
import {
  slugToNaceSection,
  slugToKraj,
  naceSectionToSlug,
  krajToSlug,
  buildNaceKrajCanonicalPath,
  buildNaceCityCanonicalPath,
} from "@/lib/seo-url";
import { getNaceSections, getKrajOptions } from "@/lib/screener";

export const revalidate = 3600;
export const dynamicParams = true;

// Pre-render all NACE × kraj combinations at build time.
// NACE × city pages are rendered on-demand (dynamicParams = true).
export function generateStaticParams() {
  const sections = getNaceSections();
  const kraje = getKrajOptions();
  const params: Array<{ "nace-slug": string; "sub-slug": string }> = [];
  for (const s of sections) {
    const naceSlug = naceSectionToSlug(s.section);
    if (!naceSlug) continue;
    for (const k of kraje) {
      const krajSlug = krajToSlug(k.value);
      if (!krajSlug) continue;
      params.push({ "nace-slug": naceSlug, "sub-slug": krajSlug });
    }
  }
  return params;
}

type SubSlugType = "kraj" | "city" | null;

async function resolveSubSlug(
  naceSlug: string,
  subSlug: string
): Promise<{ type: SubSlugType; section: string; kraj?: string; city?: string; canonicalPath: string }> {
  const section = slugToNaceSection(naceSlug);
  if (!section) return { type: null, section: "", canonicalPath: "" };

  // 1. Check if sub-slug is a kraj (region) slug
  const kraj = slugToKraj(subSlug);
  if (kraj) {
    const canonicalPath = buildNaceKrajCanonicalPath(section, kraj);
    if (canonicalPath) {
      return { type: "kraj", section, kraj, canonicalPath };
    }
  }

  // 2. Check if sub-slug is a city slug
  // Wrap in try/catch — if DB is unavailable, fall through to "not found"
  // instead of crashing generateMetadata (which would produce empty metadata)
  let cityName: string | null = null;
  try {
    cityName = await resolveCitySlug(subSlug);
  } catch {
    // DB error — treat as unresolved (page will show "not found" with noindex)
  }
  if (cityName) {
    const canonicalPath = buildNaceCityCanonicalPath(section, cityName);
    if (canonicalPath) {
      return { type: "city", section, city: cityName, canonicalPath };
    }
  }

  return { type: null, section, canonicalPath: "" };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ "nace-slug": string; "sub-slug": string }>;
}): Promise<Metadata> {
  const { "nace-slug": naceSlug, "sub-slug": subSlug } = await params;
  const resolved = await resolveSubSlug(naceSlug, subSlug);

  if (!resolved.type) {
    return {
      title: "Stránka nenájdená",
      robots: { index: false, follow: false },
    };
  }

  if (resolved.type === "kraj") {
    return generateHubMetadata({
      section: resolved.section,
      kraj: resolved.kraj,
      canonicalPath: resolved.canonicalPath,
    });
  } else {
    return generateHubMetadata({
      section: resolved.section,
      city: resolved.city,
      canonicalPath: resolved.canonicalPath,
    });
  }
}

export default async function NaceSubHubPage({
  params,
  searchParams,
}: {
  params: Promise<{ "nace-slug": string; "sub-slug": string }>;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const { "nace-slug": naceSlug, "sub-slug": subSlug } = await params;
  const resolved = await resolveSubSlug(naceSlug, subSlug);

  if (!resolved.type) {
    return (
      <div className="min-h-screen" style={{ background: "var(--bg)" }}>
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <h1 className="text-2xl font-black mb-4" style={{ color: "var(--text)" }}>
            Stránka nenájdená
          </h1>
          <p style={{ color: "var(--text-secondary)" }}>
            Hľadaná kombinácia odvetvia a regiónu/mesta sa nenašla.
          </p>
        </div>
      </div>
    );
  }

  if (resolved.type === "kraj") {
    return renderHubPage(
      { section: resolved.section, kraj: resolved.kraj, canonicalPath: resolved.canonicalPath },
      searchParams,
      resolved.canonicalPath
    );
  } else {
    return renderHubPage(
      { section: resolved.section, city: resolved.city, canonicalPath: resolved.canonicalPath },
      searchParams,
      resolved.canonicalPath
    );
  }
}
