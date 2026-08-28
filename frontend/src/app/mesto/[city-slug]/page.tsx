import type { Metadata } from "next";
import { renderHubPage, generateHubMetadata } from "@/components/hub-page";
import { resolveCitySlug } from "@/lib/hub";

export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: { "city-slug": string };
}): Promise<Metadata> {
  const cityName = await resolveCitySlug(params["city-slug"]);
  if (!cityName) {
    return {
      title: "Mesto nenájdené",
      robots: { index: false, follow: false },
    };
  }
  return generateHubMetadata({ city: cityName });
}

export default async function MestoPage({
  params,
  searchParams,
}: {
  params: { "city-slug": string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const cityName = await resolveCitySlug(params["city-slug"]);
  if (!cityName) {
    return (
      <div className="min-h-screen" style={{ background: "var(--bg)" }}>
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <h1 className="text-2xl font-black mb-4" style={{ color: "var(--text)" }}>
            Mesto nenájdené
          </h1>
          <p style={{ color: "var(--text-secondary)" }}>
            Mesto s týmto názvom sa nenašlo v databáze firiem.
          </p>
        </div>
      </div>
    );
  }

  return renderHubPage({ city: cityName }, searchParams, `/mesto/${params["city-slug"]}`);
}
