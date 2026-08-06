import type { Metadata } from "next";
import { headers } from "next/headers";
import { getLangFromHeaders, generatePageMetadata } from "@/lib/seo";

export async function generateMetadata(): Promise<Metadata> {
  const h = await headers();
  const lang = getLangFromHeaders(h);
  return generatePageMetadata("documents", lang);
}

export default function DocumentsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
